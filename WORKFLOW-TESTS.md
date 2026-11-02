# Work order workflow checks

Run these checks against a disposable Supabase project with separate test
accounts. Never use live customer or staff data for workflow testing.

## Roles and access

- [ ] Signed-out visitors cannot read or change work orders.
- [ ] Reception/admin can open and update work orders.
- [ ] Artists can update only work assigned to them.
- [ ] Operators can use print controls but cannot change artwork details.
- [ ] Non-admin users cannot grant themselves roles or deactivate accounts.
- [ ] The database rejects actions the interface does not allow.

## Work order lifecycle

- [ ] Create a job with and without an assigned artist.
- [ ] Assign an artist and verify the job appears in their workload.
- [ ] Add and remove proof files; verify the status follows the file/review rules.
- [ ] Search and filter by number, description, artist, status, and due date.
- [ ] Verify overdue and urgent jobs are visually easy to identify.
- [ ] Add comments and mentions; verify the notification opens the right ticket.
- [ ] Send a reviewed job to the print queue.

## Print queue and reporting

- [ ] Confirm the queue updates when a job is sent to print.
- [ ] Claim a job, change print progress, and test pause/resume timers.
- [ ] Record printed quantities and report a print issue.
- [ ] Complete the print and verify the role boundary for print completion.
- [ ] Review the job, release or return it, and verify report totals.
- [ ] Test queue and ticket layouts at desktop, tablet, and phone widths.

## Commands

```powershell
cd app
npm test
npm run lint
npm run build
```
