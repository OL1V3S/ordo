import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ListRow from './ListRow'

describe('ListRow', () => {
  it('renders label, title, meta, amount and actions in order inside an li', () => {
    render(<ul><ListRow className="x" label="Kind" title="Coffee" meta="Today" amount={<strong>$4.00</strong>}
      actions={<button type="button">Edit</button>} /></ul>)
    const row = screen.getByRole('listitem')
    expect(row).toHaveClass('ui-list-row', 'x')
    expect([...row.children].map((child) => child.className)).toEqual(['ui-list-row__main', 'ui-list-row__amount', 'ui-list-row__actions'])
    expect([...row.firstChild.children].map((child) => child.tagName)).toEqual(['SPAN', 'STRONG', 'P'])
    expect(screen.getByText('$4.00')).toBeInTheDocument()
  })

  it('omits optional label, meta and actions', () => {
    render(<ul><ListRow title="Coffee" amount="$4.00" /></ul>)
    const row = screen.getByRole('listitem')
    expect(row.querySelector('.ui-list-row__label')).toBeNull()
    expect(row.querySelector('.ui-list-row__meta')).toBeNull()
    expect(row.querySelector('.ui-list-row__actions')).toBeNull()
  })

  it('passes extra attributes to the li without overriding the computed className', () => {
    render(<ul><ListRow className="x" aria-label="Row name" data-kind="k" title="Coffee" amount="$4.00" /></ul>)
    const row = screen.getByRole('listitem')
    expect(row).toHaveAccessibleName('Row name')
    expect(row).toHaveAttribute('data-kind', 'k')
    expect(row).toHaveClass('ui-list-row', 'x')
  })

  it('omits the amount box when there is no amount but keeps 0 and strings', () => {
    const { rerender } = render(<ul><ListRow title="Coffee" /></ul>)
    expect(screen.getByRole('listitem').querySelector('.ui-list-row__amount')).toBeNull()
    rerender(<ul><ListRow title="Coffee" amount={0} /></ul>)
    expect(screen.getByRole('listitem').querySelector('.ui-list-row__amount')).toHaveTextContent('0')
    rerender(<ul><ListRow title="Coffee" amount="$4.00" /></ul>)
    expect(screen.getByRole('listitem').querySelector('.ui-list-row__amount')).toHaveTextContent('$4.00')
  })

  it('renders the title as a heading with titleAs and keeps strong by default', () => {
    const { rerender } = render(<ul><ListRow titleAs="h3" title="Rent" /></ul>)
    expect(screen.getByRole('heading', { level: 3, name: 'Rent' })).toHaveClass('ui-list-row__title')
    rerender(<ul><ListRow title="Rent" /></ul>)
    expect(screen.getByRole('listitem').querySelector('strong.ui-list-row__title')).not.toBeNull()
  })

  it('renders children in an extra slot after the actions and only then adds the wrap modifier', () => {
    const { rerender } = render(<ul><ListRow title="Rent" amount="$1" actions={<button type="button">Go</button>}><p>Extra</p></ListRow></ul>)
    const row = screen.getByRole('listitem')
    expect(row).toHaveClass('ui-list-row--with-extra')
    expect([...row.children].map((child) => child.className)).toEqual(['ui-list-row__main', 'ui-list-row__amount', 'ui-list-row__actions', 'ui-list-row__extra'])
    expect(row.querySelector('.ui-list-row__extra')).toHaveTextContent('Extra')
    rerender(<ul><ListRow title="Rent" amount="$1" /></ul>)
    expect(screen.getByRole('listitem')).not.toHaveClass('ui-list-row--with-extra')
    expect(screen.getByRole('listitem').querySelector('.ui-list-row__extra')).toBeNull()
  })
})
