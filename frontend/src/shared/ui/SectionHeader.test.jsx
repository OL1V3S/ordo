import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SectionHeader from './SectionHeader'

describe('SectionHeader', () => {
  it('renders the requested heading level and id', () => {
    render(<SectionHeader level={3} id="h" title="Title" />)
    const heading = screen.getByRole('heading', { level: 3, name: 'Title' })
    expect(heading).toHaveAttribute('id', 'h')
    expect(heading).not.toHaveAttribute('tabindex')
  })

  it('is programmatically focusable and exposes its ref', () => {
    const ref = createRef()
    render(<SectionHeader id="h" title="Title" focusable headingRef={ref} />)
    expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute('tabindex', '-1')
    expect(ref.current).toBe(screen.getByRole('heading'))
  })

  it('renders one optional action', () => {
    render(<SectionHeader title="Title" action={<button type="button">Act</button>} />)
    expect(screen.getByRole('button', { name: 'Act' })).toBeInTheDocument()
  })
})
