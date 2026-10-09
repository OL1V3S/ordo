import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import StatusStrip from './StatusStrip'

describe('StatusStrip', () => {
  it('is always mounted, empty and role-less when idle, and keeps its node', () => {
    const { container, rerender } = render(<StatusStrip />)
    const strip = container.firstChild
    expect(strip).toHaveAttribute('aria-live', 'polite')
    expect(strip).not.toHaveAttribute('role')
    expect(strip).toBeEmptyDOMElement()
    rerender(<StatusStrip messages={[{ id: 'a', tone: 'warning', text: 'Careful' }]} />)
    expect(container.firstChild).toBe(strip)
    expect(screen.getByText('Careful')).toHaveClass('status-message', 'status-message--warning')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    rerender(<StatusStrip />)
    expect(container.firstChild).toBe(strip)
    expect(strip).toBeEmptyDOMElement()
  })

  it('supports assertive politeness', () => {
    const { container } = render(<StatusStrip politeness="assertive" />)
    expect(container.firstChild).toHaveAttribute('aria-live', 'assertive')
  })

  it('shows only the first message by default and honors limit', () => {
    const messages = [{ id: 'a', text: 'First' }, { id: 'b', text: 'Second' }]
    const { rerender } = render(<StatusStrip messages={messages} />)
    expect(screen.queryByText('Second')).not.toBeInTheDocument()
    rerender(<StatusStrip messages={messages} limit={2} />)
    expect(screen.getByText('Second')).toHaveClass('status-message--info')
  })

  it('renders visually hidden messages as sr-only', () => {
    render(<StatusStrip messages={[{ id: 'a', text: 'Summary', visuallyHidden: true }]} />)
    expect(screen.getByText('Summary')).toHaveClass('sr-only')
  })

  it('renders a single action button', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<StatusStrip action={{ label: 'Retry', onClick }} />)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
