import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import RowActionsMenu from './RowActionsMenu'

function renderMenu(props = {}) {
  const onEdit = vi.fn()
  const onDelete = vi.fn()
  render(<div><h1 tabIndex={-1}>Page</h1><button type="button">outside</button>
    <RowActionsMenu triggerLabel="More" editLabel="Edit it" editText="Edit" deleteLabel="Delete it" deleteText="Remove"
      canEdit canDelete deleteClassName="button-ghost" onEdit={onEdit} onDelete={onDelete} {...props} /></div>)
  return { onEdit, onDelete }
}

describe('shared RowActionsMenu', () => {
  it('keeps the panel hidden until opened, without a menu role', async () => {
    const user = userEvent.setup()
    renderMenu()
    const panel = document.querySelector('.row-actions-menu__panel')
    expect(panel).not.toBeVisible()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More' }))
    expect(panel).toBeVisible()
    expect(screen.getByRole('button', { name: 'Delete it' })).toHaveClass('button-ghost')
  })

  it('closes with Escape back to the trigger and on an outside pointerdown', async () => {
    const user = userEvent.setup()
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'More' })
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'outside' }))
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('passes the trigger to the chosen handler and returns focus to it', async () => {
    const user = userEvent.setup()
    const { onEdit, onDelete } = renderMenu()
    const trigger = screen.getByRole('button', { name: 'More' })
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Edit it' }))
    expect(onEdit).toHaveBeenCalledWith(trigger)
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Delete it' }))
    expect(onDelete).toHaveBeenCalledWith(trigger)
  })

  it('disables the trigger when both actions are unavailable', () => {
    renderMenu({ canEdit: false, canDelete: false })
    expect(screen.getByRole('button', { name: 'More' })).toBeDisabled()
  })

  describe('generic items mode', () => {
    function renderItems(items) {
      render(<div><h1 tabIndex={-1}>Page</h1><RowActionsMenu triggerLabel="Actions for Rent" items={items} /></div>)
    }

    it('renders the given items with their accessible names instead of Edit and Delete', async () => {
      const user = userEvent.setup()
      renderItems([
        { key: 'a', label: 'Pause Rent', text: 'Pause', onSelect: vi.fn() },
        { key: 'b', label: 'End Rent', text: 'End', className: 'button-danger', disabled: true, onSelect: vi.fn() },
      ])
      await user.click(screen.getByRole('button', { name: 'Actions for Rent' }))
      expect(screen.getByRole('button', { name: 'Pause Rent' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'End Rent' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'End Rent' })).toHaveClass('button-danger')
      expect(screen.queryByRole('button', { name: 'Edit it' })).not.toBeInTheDocument()
    })

    it('disables the trigger only when every item is disabled', () => {
      renderItems([{ key: 'a', label: 'A', text: 'A', disabled: true, onSelect: vi.fn() }])
      expect(screen.getByRole('button', { name: 'Actions for Rent' })).toBeDisabled()
    })

    it('closes, focuses the trigger and calls onSelect with it when an item is chosen', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      renderItems([{ key: 'a', label: 'Pause Rent', text: 'Pause', onSelect }])
      const trigger = screen.getByRole('button', { name: 'Actions for Rent' })
      await user.click(trigger)
      await user.click(screen.getByRole('button', { name: 'Pause Rent' }))
      expect(onSelect).toHaveBeenCalledWith(trigger)
      expect(trigger).toHaveFocus()
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
    })
  })
})
