// A sample application form with one question of every kind Atlas Autofill answers, for the
// evals of the answer rules (lib/evals/suites/apply.ts). Pure.

import type { FormQuestion } from "./applyPacket";

/** The Career page anchor of the test card; the push notification opens it. */

/** The stand-in employer. It names itself a test wherever it appears. */
export const TEST_COMPANY = "Sample Company (test)";

const YES_NO = [
  { label: "Yes", value: "1" },
  { label: "No", value: "0" },
];

/**
 * The questions a typical Greenhouse form asks, one of each kind the agent handles: contact
 * details, the resume, links, an answer-bank question, the eligibility questions, a question
 * of the form's own (drafted from your resume), your default "how did you hear" answer, a
 * demographic question (your own Gender answer, or declined), and an optional question nobody
 * answers (left blank).
 */
export const TEST_FORM: readonly FormQuestion[] = [
  { name: "first_name", label: "First Name", required: true, kind: "text" },
  { name: "last_name", label: "Last Name", required: true, kind: "text" },
  { name: "email", label: "Email", required: true, kind: "text" },
  { name: "phone", label: "Phone", required: true, kind: "text" },
  { name: "location", label: "Location (City)", required: true, kind: "typeahead" },
  { name: "resume", label: "Resume/CV", required: true, kind: "file" },
  { name: "question_linkedin", label: "LinkedIn Profile", required: false, kind: "text" },
  { name: "question_github", label: "GitHub", required: false, kind: "text" },
  { name: "question_why", label: "Why do you want to work at Sample Company?", required: true, kind: "textarea" },
  { name: "question_authorized", label: "Are you legally authorized to work in the United States?", required: true, kind: "select", options: YES_NO },
  { name: "question_sponsorship", label: "Will you now or in the future require sponsorship for employment visa status?", required: true, kind: "select", options: YES_NO },
  { name: "question_worked", label: "Have you previously been employed by Sample Company?", required: true, kind: "select", options: YES_NO },
  { name: "question_open", label: "Tell us about a time you solved a hard technical problem for a customer.", required: true, kind: "textarea" },
  { name: "question_heard", label: "How did you hear about this job?", required: false, kind: "text" },
  { name: "question_office", label: "Which office would you prefer?", required: false, kind: "select", options: [{ label: "Lehi", value: "1" }, { label: "Remote", value: "2" }, { label: "No preference", value: "3" }] },
  { name: "gender", label: "Gender", required: false, kind: "select", options: [{ label: "Male", value: "1" }, { label: "Female", value: "2" }, { label: "I don't wish to answer", value: "3" }] },
];

/** Where a test's resume PDF is kept: one per role, replaced by the next test of that role. */
