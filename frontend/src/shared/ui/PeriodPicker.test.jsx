import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import PeriodPicker from './PeriodPicker'

function renderPicker(props = {}) {
  const onChange = vi.fn()
  const view = render(<PeriodPicker value="2026-08" currentValue="2026-05" onChange={onChange} label="Month"
    previousLabel="Back" nextLabel="Forward" currentLabel="Now" emptyLabel="None" formatMonth={(month) => `M ${month}`} {...props} />)
  return { onChange, ...view }
}

describe('PeriodPicker', () => {
  it('labels exactly one element with the label text', () => {
    renderPicker()
    expect(screen.getAllByLabelText('Month')).toHaveLength(1)
    expect(screen.getByLabelText('Month')).toHaveValue('2026-08')
  })

  it('renders 25 months centred on the value and recentres after a change', () => {
    const { rerender, onChange } = renderPicker()
    const values = () => Array.from(screen.getByLabelText('Month').options).map((option) => option.value)
    expect(values()).toHaveLength(25)
    expect(values()[0]).toBe('2025-08')
    expect(values()[12]).toBe('2026-08')
    expect(values()[24]).toBe('2027-08')
    rerender(<PeriodPicker value="2027-08" currentValue="2026-05" onChange={onChange} label="Month" previousLabel="Back"
      nextLabel="Forward" currentLabel="Now" emptyLabel="None" formatMonth={(month) => `M ${month}`} />)
    expect(values()[24]).toBe('2028-08')
  })

  it('emits exact values from previous, next, the select, and the current button', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker({ value: '2026-01' })
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onChange).toHaveBeenLastCalledWith('2025-12')
    await user.click(screen.getByRole('button', { name: 'Forward' }))
    expect(onChange).toHaveBeenLastCalledWith('2026-02')
    await user.selectOptions(screen.getByLabelText('Month'), '2025-06')
    expect(onChange).toHaveBeenLastCalledWith('2025-06')
    await user.click(screen.getByRole('button', { name: 'Now' }))
    expect(onChange).toHaveBeenLastCalledWith('2026-05')
    expect(screen.getByLabelText('Month')).toHaveFocus()
    expect(onChange).toHaveBeenCalledTimes(4)
  })

  it('renders an empty option, centres on the current value, and disables stepping when the value is empty', () => {
    renderPicker({ value: '' })
    const select = screen.getByLabelText('Month')
    expect(select).toHaveValue('')
    expect(select.options).toHaveLength(26)
    expect(select.options[0]).toHaveTextContent('None')
    expect(select.options[13].value).toBe('2026-05')
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled()
  })

  it('disables every control and the current button when already current', () => {
    const { rerender, onChange } = renderPicker({ disabled: true })
    for (const control of [screen.getByLabelText('Month'), screen.getByRole('button', { name: 'Back' }),
      screen.getByRole('button', { name: 'Forward' }), screen.getByRole('button', { name: 'Now' })]) expect(control).toBeDisabled()
    rerender(<PeriodPicker value="2026-05" currentValue="2026-05" onChange={onChange} label="Month" previousLabel="Back"
      nextLabel="Forward" currentLabel="Now" emptyLabel="None" formatMonth={(month) => month} />)
    expect(screen.getByRole('button', { name: 'Now' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled()
  })
})
