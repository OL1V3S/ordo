import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Disclosure, { DisclosureButton, DisclosurePanel } from './Disclosure'
import { useForcedOpen } from './useForcedOpen'

describe('DisclosureButton', () => {
  it('wires aria attributes when closed and open', () => {
    const { rerender } = render(<DisclosureButton controls="body" open={false} onToggle={() => {}}>Records</DisclosureButton>)
    const button = screen.getByRole('button', { name: 'Records' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAttribute('aria-controls', 'body')
    expect(button).not.toHaveAttribute('aria-disabled')
    expect(button).not.toHaveAttribute('aria-describedby')
    rerender(<DisclosureButton controls="body" open onToggle={() => {}}>Records</DisclosureButton>)
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })

  it('calls onToggle on click, Enter and Space', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(<DisclosureButton controls="body" open={false} onToggle={onToggle}>Records</DisclosureButton>)
    const button = screen.getByRole('button')
    await user.click(button)
    button.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onToggle).toHaveBeenCalledTimes(3)
  })

  it('stays focusable, described by the hint, and ignores clicks while forced', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(<DisclosureButton controls="body" open forced hint="Needed now" onToggle={onToggle}>Records</DisclosureButton>)
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAccessibleDescription('Needed now')
    expect(document.getElementById('body-hint')).toHaveClass('sr-only')
    await user.click(button)
    expect(onToggle).not.toHaveBeenCalled()
    expect(button).toHaveFocus()
  })

  it('supports a custom hint id', () => {
    render(<DisclosureButton controls="body" hintId="custom" open forced hint="Why" onToggle={() => {}}>Records</DisclosureButton>)
    expect(screen.getByRole('button')).toHaveAttribute('aria-describedby', 'custom')
    expect(document.getElementById('custom')).toHaveTextContent('Why')
  })
})

describe('DisclosurePanel', () => {
  it('is hidden unless open', () => {
    const { rerender } = render(<DisclosurePanel id="p" open={false}>Body</DisclosurePanel>)
    expect(document.getElementById('p')).toHaveAttribute('hidden')
    rerender(<DisclosurePanel id="p" open>Body</DisclosurePanel>)
    expect(document.getElementById('p')).not.toHaveAttribute('hidden')
  })
})

describe('useForcedOpen', () => {
  function Probe({ forced }) {
    const { open, toggle } = useForcedOpen(forced)
    return <button type="button" onClick={toggle}>{open ? 'open' : 'closed'}</button>
  }

  it('toggles and stays open after a forced period clears', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Probe forced={false} />)
    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('button')).toHaveTextContent('open')
    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('button')).toHaveTextContent('closed')
    rerender(<Probe forced />)
    expect(screen.getByRole('button')).toHaveTextContent('open')
    rerender(<Probe forced={false} />)
    expect(screen.getByRole('button')).toHaveTextContent('open')
  })
})

describe('Disclosure', () => {
  it('composes button and panel without a heading in the button', async () => {
    const user = userEvent.setup()
    render(<Disclosure id="box" label="More" hint="Hint"><p>Content</p></Disclosure>)
    expect(document.getElementById('box')).toHaveAttribute('hidden')
    await user.click(screen.getByRole('button', { name: 'More' }))
    expect(document.getElementById('box')).not.toHaveAttribute('hidden')
    expect(screen.getByRole('button')).not.toContainElement(screen.queryByRole('heading'))
  })

  it('forces open with a described button', () => {
    function Wrapper() {
      const [forced] = useState(true)
      return <Disclosure id="box" label="More" hint="Hint" forced={forced}>Content</Disclosure>
    }
    render(<Wrapper />)
    expect(document.getElementById('box')).not.toHaveAttribute('hidden')
    expect(screen.getByRole('button')).toHaveAccessibleDescription('Hint')
  })
})
