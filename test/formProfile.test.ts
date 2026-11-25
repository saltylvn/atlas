import { describe, expect, it } from "vitest";
import { buildPacket, type FormQuestion } from "@/lib/domain/applyPacket";
import { profileField, profileOf, profileOption } from "@/lib/domain/formProfile";

// The owner's fixed profile answers on forms (23 Nov 2026): phone code 1, country United States
// (or USA), city, school, degree, discipline and graduation year. The values here are samples.

const SAVED = { phoneCode: "1", country: "United States", city: "Springfield", school: "State University - North", degree: "Bachelor of Science", discipline: "Business Administration", gradYear: "2025" };
const profile = profileOf(SAVED);
const opts = (...labels: string[]) => labels.map((label, i) => ({ label, value: String(i) }));
const packet = (q: FormQuestion, saved: Record<string, string> = SAVED) =>
  buildPacket({ questions: [q], answers: {}, eligibility: undefined, profile: saved, job: { company: "Acme", role: "Engineer" }, resumeReady: true });

describe("Which profile answer a question asks for", () => {
  it("reads the usual labels, the phone's country code before country", () => {
    expect(profileField("country code")).toBe("phoneCode");
    expect(profileField("phone country")).toBe("phoneCode");
    expect(profileField("country")).toBe("country");
    expect(profileField("country of residence")).toBe("country");
    expect(profileField("location city")).toBe("city");
    expect(profileField("school")).toBe("school");
    expect(profileField("school or university")).toBe("school");
    expect(profileField("degree")).toBe("degree");
    expect(profileField("highest level of education")).toBe("degree");
    expect(profileField("discipline")).toBe("discipline");
    expect(profileField("field of study")).toBe("discipline");
    expect(profileField("graduation date")).toBe("gradYear");
    expect(profileField("end date year", "education[0][end_date][year]")).toBe("gradYear");
  });

  it("leaves alone what is not yours to answer this way", () => {
    expect(profileField("country of citizenship")).toBeNull();
    expect(profileField("which countries are you authorized to work in")).toBeNull();
    expect(profileField("end date year", "employment[0][end_date][year]")).toBeNull();
    expect(profileField("end date month", "education[0][end_date][month]")).toBeNull();
    expect(profileField("did you graduate from college")).toBeNull();
  });
});

describe("Picking your answer from a list", () => {
  it("country: United States, else USA; never a place that only starts the same", () => {
    expect(profileOption("country", profile, opts("Canada", "United States", "USA"))!.label).toBe("United States");
    expect(profileOption("country", profile, opts("Canada", "USA", "Mexico"))!.label).toBe("USA");
    expect(profileOption("country", profile, opts("United States of America", "Canada"))!.label).toBe("United States of America");
    expect(profileOption("country", profile, opts("United States Minor Outlying Islands", "Canada"))).toBeNull();
    expect(profileOption("country", profile, opts("United States (+1)", "Canada (+1)"))!.label).toBe("United States (+1)");
  });

  it("phone code: your country's +1, a bare +1, never Canada's", () => {
    expect(profileOption("phoneCode", profile, opts("Canada (+1)", "United States (+1)", "United Kingdom (+44)"))!.label).toBe("United States (+1)");
    expect(profileOption("phoneCode", profile, opts("+44", "+1", "+91"))!.label).toBe("+1");
    expect(profileOption("phoneCode", profile, opts("US +1", "+12"))!.label).toBe("US +1");
    expect(profileOption("phoneCode", profile, opts("Canada (+1)", "Mexico (+52)"))).toBeNull();
  });

  it("degree: your words, else the plain Bachelor's choice; never a Bachelor of Arts", () => {
    expect(profileOption("degree", profile, opts("Associate's", "Bachelor of Science", "Master's"))!.label).toBe("Bachelor of Science");
    expect(profileOption("degree", profile, opts("High School", "Bachelor's Degree", "Master's Degree"))!.label).toBe("Bachelor's Degree");
    expect(profileOption("degree", profile, opts("BA", "BS", "MS"))!.label).toBe("BS");
    expect(profileOption("degree", profile, opts("Bachelor of Arts", "Master of Science"))).toBeNull();
  });

  it("school, city and discipline: the same name whatever the punctuation; a place or subject may say more", () => {
    expect(profileOption("school", profile, opts("State University", "State University-North"))!.label).toBe("State University-North");
    expect(profileOption("school", profile, opts("State University"))).toBeNull();
    expect(profileOption("city", profile, opts("Springfield, IL", "Springfield Gardens, NY, United States"))!.label).toBe("Springfield, IL");
    expect(profileOption("discipline", profile, opts("Business", "Business Administration and Management"))!.label).toBe("Business Administration and Management");
    expect(profileOption("gradYear", profile, opts("2024", "2025", "2026"))!.label).toBe("2025");
  });
});

describe("The packet uses them", () => {
  it("types them in boxes, picks them in lists, and searches by country for the phone code", () => {
    expect(packet({ name: "phone_code", label: "Country code", required: true, kind: "text" }).items[0]).toMatchObject({ value: "+1", source: "eligibility" });
    expect(packet({ name: "school", label: "School", required: true, kind: "typeahead" }).items[0]).toMatchObject({ value: "State University - North" });
    expect(packet({ name: "phone_country", label: "Country", required: true, kind: "typeahead" }).items[0]).toMatchObject({ value: "United States" });
    expect(packet({ name: "g", label: "Graduation year", required: false, kind: "text" }).items[0]).toMatchObject({ value: "2025" });
    const deg = packet({ name: "degree", label: "Degree", required: true, kind: "select", options: opts("Bachelor's Degree", "Master's Degree") });
    expect(deg.items[0]).toMatchObject({ value: "Bachelor's Degree", optionValue: "0" });
    expect(deg.stops).toEqual([]);
  });

  it("before you save any: country and phone code still answer; the education questions wait for you", () => {
    const p = buildPacket({ questions: [{ name: "c", label: "Country", required: true, kind: "select", options: opts("Canada", "United States") }, { name: "s", label: "School", required: true, kind: "text" }], answers: {}, eligibility: undefined, job: { company: "Acme", role: "Engineer" }, resumeReady: true });
    expect(p.items[0]).toMatchObject({ value: "United States" });
    expect(p.stops).toEqual(['"School" needs your school in Settings']);
  });
});
