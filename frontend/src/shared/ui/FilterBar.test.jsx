import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import FilterBar from './FilterBar'

const OPTIONS = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]

function Harness({ forced = false, invalid = false, initialChips = ['one', 'two', 'three'], showChips = true, onClear = () => {}, status = [] }) {
  const [chips, setChips] = useState(initialChips.map((key) => ({ key, label: key })))
  const [period, setPeriod] = useState('a')
  const [q, setQ] = useState('')
  return (
    <FilterBar
      search={{ label: 'Find', value: q, onChange: setQ, placeholder: 'Type', maxLength: 10, invalid }}
      toggle={{ label: 'Filters', hint: 'Open because of an error', panelId: 'panel', hintId: 'panel-hint', forced }}
      periods={{ label: 'Period', value: period, options: OPTIONS, onChange: setPeriod }}
      fields={<label>Kind<select><option>All</option></select></label>}
      chips={chips} showChips={showChips} chipsLabel="Active filters"
      removeLabel={(chip) => `Remove ${chip.label}`}
      onRemove={(key) => setChips((current) => current.filter((chip) => chip.key !== key))}
      clearLabel="Clear" onClear={() => { setChips([]); onClear() }}
      status={status}
    />
  )
}

describe('FilterBar', () => {
  it('labels the search field and marks it invalid', () => {
    render(<Harness invalid />)
    const search = screen.getByRole('searchbox', { name: 'Find' })
    expect(search).toHaveAttribute('aria-invalid', 'true')
    expect(search).toHaveAttribute('placeholder', 'Type')
  })

  it('keeps the panel hidden until the toggle opens it', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(document.getElementById('panel')).toHaveAttribute('hidden')
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    expect(document.getElementById('panel')).not.toHaveAttribute('hidden')
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('exposes the period group and pressed state', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    const group = screen.getByRole('group', { name: 'Period' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Beta' }))
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders the chips group only when requested', () => {
    const { unmount } = render(<Harness />)
    expect(screen.getByRole('group', { name: 'Active filters' })).toBeInTheDocument()
    unmount()
    render(<Harness showChips={false} />)
    expect(screen.queryByRole('group', { name: 'Active filters' })).not.toBeInTheDocument()
  })

  it('moves focus to the next chip, then the previous, then search after removal', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Remove one' }))
    expect(screen.getByRole('button', { name: 'Remove two' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Remove three' }))
    expect(screen.getByRole('button', { name: 'Remove two' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Remove two' }))
    expect(screen.getByRole('searchbox')).toHaveFocus()
  })

  it('clears and focuses search', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(<Harness onClear={onClear} />)
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClear).toHaveBeenCalled()
    expect(screen.getByRole('searchbox')).toHaveFocus()
  })

  it('opens the panel and disables the toggle when forced', async () => {
    const user = userEvent.setup()
    render(<Harness forced />)
    const toggle = screen.getByRole('button', { name: 'Filters' })
    expect(document.getElementById('panel')).not.toHaveAttribute('hidden')
    expect(toggle).toHaveAttribute('aria-disabled', 'true')
    await user.click(toggle)
    expect(document.getElementById('panel')).not.toHaveAttribute('hidden')
  })

  it('has one polite container that keeps its identity', () => {
    const { container, rerender } = render(<Harness />)
    const live = container.querySelectorAll('[aria-live]')
    expect(live).toHaveLength(1)
    expect(live[0]).toBeEmptyDOMElement()
    rerender(<Harness status={[{ id: 'x', tone: 'warning', text: 'Bad range' }]} />)
    expect(container.querySelector('[aria-live]')).toBe(live[0])
    expect(live[0]).toHaveTextContent('Bad range')
  })
})
