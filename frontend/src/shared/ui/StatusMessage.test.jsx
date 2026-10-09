import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import StatusMessage from './StatusMessage'

describe('StatusMessage', () => {
  it('applies the warning tone class', () => {
    render(<StatusMessage tone="warning">Careful</StatusMessage>)
    const message = screen.getByRole('status')
    expect(message).toHaveClass('status-message', 'status-message--warning')
  })

  it('uses alert only for the danger tone', () => {
    const { rerender } = render(<StatusMessage tone="danger">Bad</StatusMessage>)
    expect(screen.getByRole('alert')).toHaveClass('status-message--danger')
    for (const tone of ['info', 'success', 'warning']) {
      rerender(<StatusMessage tone={tone}>Fine</StatusMessage>)
      expect(screen.getByRole('status')).toHaveClass(`status-message--${tone}`)
    }
  })

  it('keeps the exact class string without extra props', () => {
    render(<StatusMessage>Plain</StatusMessage>)
    expect(screen.getByRole('status').className).toBe('status-message status-message--info')
  })

  it('passes extra props, className and ref to the paragraph', () => {
    const ref = createRef()
    render(<StatusMessage ref={ref} tone="success" tabIndex="-1" aria-live="polite" id="m" className="extra">Done</StatusMessage>)
    const message = screen.getByRole('status')
    expect(ref.current).toBe(message)
    expect(message.tagName).toBe('P')
    expect(message).toHaveAttribute('tabindex', '-1')
    expect(message).toHaveAttribute('aria-live', 'polite')
    expect(message).toHaveAttribute('id', 'm')
    expect(message).toHaveClass('status-message', 'status-message--success', 'extra')
  })

  it('does not let a role prop override the tone role', () => {
    render(<StatusMessage tone="danger" role="status">Bad</StatusMessage>)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
