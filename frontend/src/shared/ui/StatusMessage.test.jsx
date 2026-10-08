import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import StatusMessage from './StatusMessage'

describe('StatusMessage', () => {
  it('applies the warning tone class', () => {
    render(<StatusMessage tone="warning">Careful</StatusMessage>)
    const message = screen.getByRole('status')
    expect(message).toHaveClass('status-message', 'status-message--warning')
  })
})
