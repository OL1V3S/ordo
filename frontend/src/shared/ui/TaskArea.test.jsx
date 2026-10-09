import { createRef } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import TaskArea from './TaskArea'
import useFocusReturn from './useFocusReturn'

describe('TaskArea', () => {
  it('is hidden when closed and a labelled region when open', () => {
    const { rerender } = render(<TaskArea id="t" open={false} label="Add expense">Body</TaskArea>)
    expect(document.getElementById('t')).toHaveAttribute('hidden')
    rerender(<TaskArea id="t" open label="Add expense">Body</TaskArea>)
    expect(screen.getByRole('region', { name: 'Add expense' })).toBeInTheDocument()
  })

  it('supports labelledBy', () => {
    render(<><h2 id="h">Heading</h2><TaskArea id="t" open labelledBy="h">Body</TaskArea></>)
    expect(screen.getByRole('region', { name: 'Heading' })).toBeInTheDocument()
  })

  it('focuses the container on open when there is no initial target', async () => {
    const { rerender } = render(<TaskArea id="t" open={false} label="Task">Body</TaskArea>)
    rerender(<TaskArea id="t" open label="Task">Body</TaskArea>)
    await waitFor(() => expect(document.getElementById('t')).toHaveFocus())
  })

  it('focuses initialFocusRef on open', async () => {
    const ref = createRef()
    const view = (open) => <TaskArea id="t" open={open} label="Task" initialFocusRef={ref}><input ref={ref} aria-label="Amount" /></TaskArea>
    const { rerender } = render(view(false))
    rerender(view(true))
    await waitFor(() => expect(screen.getByLabelText('Amount')).toHaveFocus())
  })
})

describe('TaskArea autoFocus', () => {
  it('never moves focus when autoFocus is false', async () => {
    const view = (open) => <><button type="button">Elsewhere</button><TaskArea id="t" open={open} label="Task" autoFocus={false}>Body</TaskArea></>
    const { rerender } = render(view(false))
    screen.getByText('Elsewhere').focus()
    rerender(view(true))
    await new Promise((resolve) => requestAnimationFrame(() => resolve()))
    await new Promise((resolve) => requestAnimationFrame(() => resolve()))
    expect(screen.getByText('Elsewhere')).toHaveFocus()
    expect(document.getElementById('t')).not.toHaveFocus()
  })
})

describe('useFocusReturn', () => {
  function Probe({ showOpener = true, disabled = false }) {
    const focus = useFocusReturn()
    const fallback = createRef()
    return (
      <>
        {showOpener && <button type="button" disabled={disabled} onFocus={() => {}} data-testid="opener">Open</button>}
        <button type="button" ref={fallback}>Fallback</button>
        <button type="button" onClick={() => focus.remember(document.querySelector('[data-testid=opener]'))}>Remember</button>
        <button type="button" onClick={() => focus.restore(fallback)}>Restore</button>
      </>
    )
  }

  it('restores the remembered opener', () => {
    render(<Probe />)
    screen.getByText('Remember').click()
    screen.getByText('Restore').click()
    expect(screen.getByTestId('opener')).toHaveFocus()
  })

  it('falls back when the opener is disabled', () => {
    const { rerender } = render(<Probe />)
    screen.getByText('Remember').click()
    rerender(<Probe disabled />)
    screen.getByText('Restore').click()
    expect(screen.getByText('Fallback')).toHaveFocus()
  })
})
