import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ImportConfirmBar from './ImportConfirmBar'
import '../../../shared/localization/i18n'

const PROPERTY = '--import-confirm-bar-height'
const props = {
  selectedItemsLabel: '1 expense',
  totals: { expenseCount: 1, expenseCents: 850n, depositCount: 0, depositCents: 0n },
  guidance: 'Ready to confirm.',
  disabled: false,
  confirming: false,
  confirmLabel: 'Save 1 expense',
  onConfirm: vi.fn(),
}

let observers
let barHeight
const originalInnerHeight = window.innerHeight

class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback
    this.observed = []
    this.disconnected = false
    observers.push(this)
  }
  observe(element) { this.observed.push(element) }
  disconnect() { this.disconnected = true }
}

function renderBar() {
  const view = render(<div data-testid="host"><ImportConfirmBar {...props} /></div>)
  return { ...view, host: screen.getByTestId('host'), bar: screen.getByRole('group', { name: 'Rows to import' }) }
}

const resizeTo = (height) => {
  barHeight = height
  act(() => { observers.forEach((observer) => observer.callback([])) })
}

describe('ImportConfirmBar measurement', () => {
  beforeEach(() => {
    observers = []
    barHeight = 130
    window.innerHeight = 800
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      return { width: 300, height: this.classList.contains('import-confirm-bar') ? barHeight : 0, top: 0, left: 0, right: 300, bottom: 0, x: 0, y: 0, toJSON() {} }
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.innerHeight = originalInnerHeight
  })

  it('publishes its measured height on its container and keeps the bar sticky', () => {
    const { host, bar } = renderBar()
    expect(observers).toHaveLength(1)
    expect(observers[0].observed).toEqual([bar])
    expect(host.style.getPropertyValue(PROPERTY)).toBe('130px')
    expect(bar).toHaveAttribute('data-sticky', 'true')
  })

  it('updates the property when the bar resizes, rounding up', () => {
    const { host } = renderBar()
    resizeTo(212.4)
    expect(host.style.getPropertyValue(PROPERTY)).toBe('213px')
  })

  it('removes the property and observers on unmount', () => {
    const { host, unmount } = renderBar()
    const [observer] = observers
    expect(host.style.getPropertyValue(PROPERTY)).toBe('130px')
    unmount()
    expect(observer.disconnected).toBe(true)
    expect(host.style.getPropertyValue(PROPERTY)).toBe('')
  })

  it('falls back to a non-sticky bar with no scroll clearance when it takes too much of the viewport', () => {
    const { host, bar } = renderBar()
    window.innerHeight = 400
    resizeTo(200)
    expect(bar).toHaveAttribute('data-sticky', 'false')
    expect(host.style.getPropertyValue(PROPERTY)).toBe('0px')
  })

  it('sticks again when the viewport grows or the bar shrinks', () => {
    const { host, bar } = renderBar()
    window.innerHeight = 400
    resizeTo(200)
    expect(bar).toHaveAttribute('data-sticky', 'false')
    act(() => { window.innerHeight = 900; window.dispatchEvent(new Event('resize')) })
    expect(bar).toHaveAttribute('data-sticky', 'true')
    expect(host.style.getPropertyValue(PROPERTY)).toBe('200px')
  })

  it('does not publish an unmeasured (zero) height', () => {
    barHeight = 0
    const { host, bar } = renderBar()
    expect(host.style.getPropertyValue(PROPERTY)).toBe('')
    expect(bar).toHaveAttribute('data-sticky', 'true')
  })

  it('without ResizeObserver publishes nothing and stays sticky so CSS uses its default', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const { host, bar } = renderBar()
    expect(host.style.getPropertyValue(PROPERTY)).toBe('')
    expect(bar).toHaveAttribute('data-sticky', 'true')
  })
})
