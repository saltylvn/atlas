# Calendar Agent (build step 2, live)

Reviews every Google Calendar event and reports to the Chief of Staff before each brief,
in the Standard Agent Report Format.

## What it does

- Covers today and the week ahead in both weekday briefs; today and tomorrow on Saturday.
- Flags scheduling conflicts: busy, timed events that overlap. Events marked **Free** in
  Google Calendar never count as conflicts.
- Keeps important events top of mind: appointments (doctor, dentist, vet, DMV and the
  like) and job interviews, each listed with its day and time.
- Links each interview to its tracked application (the Career Agent matches calendar
  interviews to the Applications board), so it carries its role and job description link.
- For each interview, the Chief of Staff asks the Career Agent for prep notes and puts
  them alongside it in the brief.

## Limits

- Read-only. It reads the calendar through the secret iCal address and cannot change it.
- An interview that is not on the calendar becomes a **needs approval** item with a
  prefilled Google Calendar link. Nothing is added until Tyler saves it there.
- Tags events by rules, with no model call, so every run costs $0. It only receives
  the tracked interviews from the Chief of Staff, nothing else.
- If the calendar cannot be read, the run is logged as failed and the brief says so.
  When paused in Mission Control, the brief leaves the calendar out and says why.

Code: `lib/domain/calendarAgent.ts` (the report), `lib/agents/calendar.ts` (the run).
