# Atlas Autofill (Safari)

A Safari extension that fills job application forms from your Atlas answer bank when you
press **Fill**. You review the page and submit it yourself. It is semi-automated by design:
LinkedIn, Indeed and Glassdoor stay semi-automated, and so does everything else.

## What it does, and does not do

- **Fills:** name, email, phone, city, LinkedIn, GitHub and portfolio links, location and
  remote preference, start date, salary or hourly rate, years of experience, "tell us about
  yourself", "why this company" (with the company and role you confirm), "why are you
  looking", a project you are proud of, AI experience, work history, cover letter.
- **Never:** submits, clicks buttons, changes a field you already filled, attaches a file,
  or answers work authorization, sponsorship, demographic or EEO questions.
- **Where it runs:** on a job page only when you press Fill (Safari's `activeTab`), in that
  tab, in the page and its same-site frames. A form embedded from another site (a Greenhouse
  frame on a company page) cannot be reached: open the form in its own tab instead.
- **Where your answers come from:** `sync.js` runs only on your Applications page at
  atlas-optim.vercel.app. It reads the answer bank Atlas puts there and keeps a copy in the
  extension's own storage, on your Mac. Open Applications after you change an answer. No
  password, token or network request is involved.

## Build it (once)

1. Install **Xcode** from the Mac App Store (free), open it once, and accept the license.
2. In Xcode, **Settings > Accounts**, add your Apple ID. A free account is enough for your
   own Mac.
3. From the repository root, run:

   ```bash
   scripts/build-safari-extension.sh
   ```

   It wraps this folder in a small Mac app project at `~/AtlasAutofill` and opens it in Xcode.
4. In Xcode, select the **Atlas Autofill (macOS)** target, then **Signing & Capabilities**,
   and choose your Personal Team. Press **Run** (⌘R). The app opens; you can close it.
5. In Safari, **Settings > Extensions**, tick **Atlas Autofill**. Allow it on
   atlas-optim.vercel.app when Safari asks.
6. Open **Applications** in Atlas once. The card says it synced.

After you change the extension's code, run the script again and press Run in Xcode.

## Use it

On an application form, click the **A** in Safari's toolbar, check the company and role it
guessed from the page title, and press **Fill this page**. Fields it filled are outlined in
purple. On a multi-step form, press Fill on each step.
