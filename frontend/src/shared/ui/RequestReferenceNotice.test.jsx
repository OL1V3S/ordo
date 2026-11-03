import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import RequestReferenceNotice from './RequestReferenceNotice'
import { LocaleProvider } from '../localization/LocaleProvider'
import i18n from '../localization/i18n'
import { clearRequestReference, reportServerError } from '../api/requestReference'
import { clearSession, establishSession } from '../auth/session'

function renderNotice() {
  return render(<LocaleProvider><RequestReferenceNotice /></LocaleProvider>)
}

const raise = (requestId) => act(() => reportServerError({ status: 500, data: { requestId } }))

describe('RequestReferenceNotice', () => {
  beforeEach(() => {
    localStorage.clear()
    clearRequestReference()
  })
  afterEach(async () => {
    clearRequestReference()
    await i18n.changeLanguage('en')
  })

  it('renders nothing without a reference', () => {
    renderNotice()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the reference in code with a dismiss button, newest wins', async () => {
    renderNotice()
    raise('aaaaaaaa11111111')
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong on our side. If it keeps happening, share this reference: aaaaaaaa11111111')
    expect(screen.getByText('aaaaaaaa11111111').tagName).toBe('CODE')
    raise('bbbbbbbb22222222')
    expect(screen.queryByText('aaaaaaaa11111111')).not.toBeInTheDocument()
    expect(screen.getByText('bbbbbbbb22222222')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('is localized in Spanish', async () => {
    await i18n.changeLanguage('es')
    renderNotice()
    raise('aaaaaaaa11111111')
    expect(screen.getByRole('alert')).toHaveTextContent('Algo salió mal de nuestro lado. Si sigue pasando, comparte esta referencia: aaaaaaaa11111111')
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument()
  })

  it('clears when the session changes or the person signs out', () => {
    renderNotice()
    raise('aaaaaaaa11111111')
    act(() => establishSession('token-one', 'person@example.invalid'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    raise('bbbbbbbb22222222')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    act(() => clearSession())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
