# A Student's Enrollment is not tied to the Purchase that granted it

A Student has one Enrollment per course, whether it came from an Individual Purchase or a Claimed Seat, and the Enrollment doesn't record which. A Refund Request, by contrast, belongs to one specific Purchase. So approving a Refund Request on an Individual Purchase must check whether the Student also holds a Claimed Seat for that course, and leave their Enrollment alone if they do.

## Consequences

The buyer chooses which Purchase a Refund Request is for: Individual Purchases from the course page, Team Licences from the team page.
