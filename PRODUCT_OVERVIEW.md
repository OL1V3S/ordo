# Ordo Product Overview

Ordo is a personal finance web app for understanding activity in one tracked
checking account. It brings recorded spending and cash in, monthly category
budgets, and recurring expense and paycheck patterns into one place. It is for
someone who wants to organize their transactions and review what tends to recur,
while keeping control over what those patterns mean.

## How Ordo approaches money

Recorded activity, confirmed expectations, and projections have different roles.
A saved transaction records an observation. A recurring pattern is evidence to
review. Confirming a commitment or paycheck creates an expectation; it does not
prove that a future payment will happen.

This emphasis on review carries through statement import and recurring-pattern
suggestions. You choose which imported rows to save and which patterns to accept,
dismiss, or revisit. Ordo keeps the supporting evidence visible rather than
silently treating every detected pattern as a financial fact.

## What you can do today

- **Home:** Capture an expense or cash-in record before reviewing a compact,
  server-ordered list of up to three recent expenses and inflows. Exact amounts,
  posted dates, expense categories, and paycheck links are shown when available;
  unavailable reads and empty activity have distinct states. Insights remains a
  quieter link. If a save outcome is uncertain, Home directs you to review the
  complete relevant Activity list before deciding whether to retry.
- **Activity / Transactions:** Scan recorded spending first, search descriptions
  and categories, and expand date/category filters when needed. A separate Cash in
  section lists recorded incoming money with its own search. Add, edit, or delete
  expenses and cash in, or open Import statement. Cash-in edits and deletions can
  affect imported records and supporting paycheck links; visible warnings explain
  these effects. Active drafts and import review stay visible while you work.
- **Budgets:** Review category spending against the selected month’s limits,
  with visible progress and near-limit or over-limit status. Open add or edit
  when needed; drafts keep their original month. Zero limits remain explicit
  no-spend budgets, and unavailable spending is shown separately from zero.
- **Commitments:** See active saved expectations, amounts, and timing patterns
  first, then review supported changes and possible recurring expenses. Edit,
  pause, reactivate, or end saved commitments; confirm or dismiss suggestions.
  Details disclose supporting records, while inactive, reviewed, and dismissed
  history sits in expandable groups. Amount and timing comparisons and payments
  not seen recently stay visible for review; accepting a change remains your
  decision. Saved timing describes a pattern, not an upcoming payment forecast.
- **Paychecks:** See active saved expectations first, with expected amounts and
  the next available payment window, then review possible recurring deposits.
  Add a paycheck manually, manage existing profiles, or record a received
  paycheck by entering actual cash in or linking an existing unclaimed cash-in
  record. Actual dates and amounts may differ from the expectation without
  rewriting it; a mistaken receipt link can be removed without deleting the
  cash-in record. Paused, ended, and dismissed items sit in expandable groups.
  Card Details reveal linked records and schedule information. Profiles support
  several pay schedules and fixed amounts or expected ranges. These are
  expectations, not guaranteed deposits or employer-verified earnings.
- **Insights / Analytics:** Compare recorded cash in with spending for a selected
  month and see the difference as net recorded cash flow. Explore a six-month
  trend and ranked spending categories, with budget usage, month-over-month
  category changes, and largest expenses available under More spending detail.
  Cash in is split into amounts linked to confirmed
  paychecks and all other recorded inflows.
- **Statement import:** Open import from Activity and upload a supported,
  text-extractable Sunflower Bank PDF,
  review parsed rows, edit eligible expense rows, inspect possible-duplicate
  warnings, and confirm the rows to save. Selected debits become expenses.
  Credits are optional and must be explicitly selected; they become inflow
  records without automatically being classified as income or paychecks.
  Scanned PDFs are not supported.
- **Settings and account access:** Choose a System, Light, or Dark theme and an
  English or Spanish interface preference for this browser, then view your
  signed-in email in a compact account section. The language preference updates
  the authenticated shell, primary navigation, Plan and More hubs, and Settings;
  feature pages and public account-access pages remain English during the
  incremental rollout. Account access
  includes registration,
  sign-in and sign-out, email confirmation and resend, and password recovery by
  email. Settings currently provides email display, appearance, and language controls,
  rather than a full account-management area.

Navigation uses Home, Activity, and Insights consistently across screen sizes.
On smaller screens, Plan is a simple hub for Budgets, Commitments, and Paychecks.
More places Settings ahead of the explicitly unavailable Investing placeholder;
these destinations also sit below the main desktop navigation. Details and
history expand on demand, while active tasks, errors, and review warnings stay
visible. The underlying financial workflows are the same.

## What the figures mean

Ordo summarizes the records you have saved; those records may not cover all
activity in the account. Cash in includes more than earned income: other inflows
can include refunds, transfers, reimbursements, or paychecks that have not been
linked to a confirmed profile. Recorded spending represents outgoing money,
including purchases and bills as well as transfers, debt payments, or investment
funding recorded as expenses.

Net recorded cash flow is cash in minus recorded spending and can be negative.
It is **not an account balance, a savings figure, or an available/Safe-to-Spend
amount**. Budgets, commitment expectations, and paycheck projections do not add
money to historical totals. Ordo does not reconcile accounts or provide a
complete forecast of future finances. The
[financial-domain invariants](docs/financial-domain-invariants.md) define these
boundaries in more detail.

## Current shape and maturity

Ordo is an evolving product focused on recorded activity and explicit review.
It currently models one checking account, with manual expense and cash-in entry
and supported statement import rather than a live bank connection. Investing is an unavailable
placeholder, not a portfolio or investment-analysis feature.

The app has a React/Vite browser frontend hosted on Vercel, an ASP.NET Core
backend hosted on Render, and a PostgreSQL database hosted on Neon. See
[ARCHITECTURE.md](ARCHITECTURE.md) for system details and
[ROADMAP.md](ROADMAP.md) for engineering sequencing; planned work there is separate
from the capabilities described here.
