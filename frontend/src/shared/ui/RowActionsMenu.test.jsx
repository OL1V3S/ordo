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
})
