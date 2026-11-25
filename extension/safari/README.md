# Atlas Autofill (Safari)

A Safari extension for the jobs you apply to yourself, on your Mac. It is Atlas in your
toolbar: it shows your **Apply Queue** queue, fills application forms from your answer
bank when you press **Fill**, and sends you back to Atlas to mark a job submitted. You review
every page and submit it yourself. It is semi-automated by design: LinkedIn, Indeed and
Glassdoor stay semi-automated, and so does everything else.

## What it does

Press the **A** in your toolbar, then **Help me apply on this page**. A panel opens beside the form:

- **Reads every question** the way you read it: the label above the field (not "Enter" or "Search"),
  whether it is required, and every choice it offers. It handles text boxes, lists, search-and-pick
  boxes, Yes/No buttons, radios, checkboxes and file uploads, in the page and in the frames of the
  job-application sites below (an Ashby form embedded on a company's site, for example).
- **Finds the job** from the page's own data (the posting's structured data, the site's own title and
  company), or from your Apply Queue, never by guessing from the tab's title.
- **Asks Atlas to answer.** The Apply Agent answers in this order: your answer bank, your answers in
  Setup (work authorization, sponsorship, Gender, "how did you hear"), then Gemini for the lists and
  open questions nothing else answers. Gemini may only pick one of the form's own choices, must cite
  your resume or a fact you wrote, and leaves a question blank when it cannot back it up.
  Demographic, consent, money and legal questions are never sent to Gemini: they stay **yours**.
- **Shows every answer with its source** (your answer bank, your Setup answers, Gemini with its
  reason, or yours). Change anything, then press **Fill all**. It attaches the resume for the role,
  from Notion. A correction you make can be saved to your answer bank.
- **Moves the form forward** with **Next step** (Next, Continue, or opening the application from a
  job page). Never on LinkedIn, Indeed or Glassdoor, where it only fills when you press Fill all.
- **Notices when you are done**: when a job site says your application went in, the popup offers
  **Mark submitted** for that job in Atlas.

## What it never does

Click Submit or anything that sends an application, press Enter in a form, change a field you already
filled, touch password, payment or CAPTCHA fields, create an account, or answer a demographic or
consent question for you. You press the site's own Submit.

## Where it runs, and what it can reach

- **Atlas**: with a key you make in Atlas **Settings > Atlas Autofill**. Atlas keeps only its
  fingerprint. The key can only ask Atlas to answer a form, fetch your resume, and save an answer you
  corrected. Disconnect in Settings and it stops working at once. Each answered form is logged under
  the Apply Agent and counts toward a daily cap of 20 forms with Gemini.
- **Job sites**: the tab you are on when you press Help me apply, plus the frames of these
  job-application sites: Ashby, Greenhouse, Lever, Workday, JazzHR, Pinpoint, BambooHR, Workable,
  iCIMS, SmartRecruiters, Recruitee, Teamtailor, Gem, LinkedIn, Indeed and Glassdoor.

## Build it (once)

1. Install **Xcode** from the Mac App Store (free), open it once, and accept the license.
2. In Xcode, **Settings > Accounts**, add your Apple ID. A free account is enough for your
   own Mac.
3. From the repository root, run:

   ```bash
   scripts/build-safari-extension.sh
   ```

   It wraps this folder in a small Mac app project at `~/engineering-projects/AtlasAutofill` and opens it in Xcode.
4. In Xcode, press ⌘1 and click the blue **Atlas Autofill** project at the top of the list.
   Under **TARGETS** there are two: **Atlas Autofill** and **Atlas Autofill Extension**. For
   each, open **Signing & Capabilities**, tick **Automatically manage signing**, and choose
   your Personal Team. Press **Run** (⌘R). If macOS asks for a password to use the signing
   key, it is your Mac login password; choose **Always Allow**. The app opens; you can close it.
5. In Safari, **Settings > Extensions**, tick **Atlas Autofill**. Allow it on
   atlas-optim.vercel.app when Safari asks. If it is not listed: **Settings > Advanced**,
   tick **Show features for web developers**, then **Develop > Allow Unsigned Extensions**.
6. In Atlas, open **Settings** and press **Connect Atlas Autofill**. The extension picks up the
   key from that page (or paste it into the popup). Then open **Career > Apply** once so it copies
   your Apply Queue.

After the extension's code changes, run the script again and press Run in Xcode. It updates
the files inside the existing project and keeps your signing choice; run it with `--fresh`
to build the project from nothing.

## Use it

1. Click the **A** in Safari's toolbar. It lists your Apply Queue.
2. Pick a job. Its posting opens, and the extension remembers that job.
3. On the application form, click the **A** again: it shows the resume to attach and has
   the company and role filled in. Press **Fill this page**. Fields it filled are outlined
   in purple. On a multi-step form, press Fill on each step.
4. Attach the resume, review, and submit on the site yourself.
5. Click the **A** and press **Mark submitted**. Atlas opens and asks you to confirm.

For a job that is not in your queue, the popup still works as before: check the company
and role it guessed from the page title, and press Fill.
