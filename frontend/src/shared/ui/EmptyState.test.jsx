import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import EmptyState from './EmptyState'

describe('EmptyState', () => {
  it('renders the inline variant as a muted paragraph', () => {
    render(<EmptyState>Nothing yet</EmptyState>)
    const text = screen.getByText('Nothing yet')
    expect(text.tagName).toBe('P')
    expect(text).toHaveClass('muted')
    expect(text).not.toHaveAttribute('role')
  })

  it('renders the block variant with title and action', () => {
    const { container } = render(<EmptyState variant="block" title="Empty" action={<button type="button">Add</button>}>Body</EmptyState>)
    expect(container.firstChild).toHaveClass('empty-state')
    expect(screen.getByText('Empty')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })
})
