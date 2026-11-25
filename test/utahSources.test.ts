import { describe, expect, it } from "vitest";
import { boardHost, boardUrl, normalize } from "@/lib/integrations/jobBoards";
import { boardsInHtml } from "@/lib/domain/boardFinder";
import { JOB_SOURCES, sourceGroup, UTAH_LIST_TAG } from "@/lib/domain/jobSources";
import { observeTech } from "@/lib/domain/techMarket";
import { assertAllowed } from "@/lib/security/safeFetch";

// Shapes as the live APIs sent them on 22 Nov 2026 (trimmed).
const BAMBOO = {
  meta: { totalCount: 2 },
  result: [
    { id: "351", jobOpeningName: "Software Engineer", departmentLabel: "Product", employmentStatusLabel: "Full-Time", location: { city: "Lehi", state: "Utah" }, atsLocation: { country: null }, isRemote: null, locationType: "0" },
    { id: 52, jobOpeningName: "Data Analyst", employmentStatusLabel: "Part-Time", location: { city: null, state: null }, isRemote: true },
  ],
};
const APPLICANTPRO = `<rss version='2.0'><channel><title><![CDATA[Utah State Courts]]></title>
<item><title><![CDATA[IT Systems Administrator]]></title><description><![CDATA[Manage &amp; patch Linux servers. <b>AWS</b> and Python a plus.]]></description>
<link><![CDATA[https://utcourts.applicantpro.com/jobs/4218031.html]]></link><guid><![CDATA[https://utcourts.applicantpro.com/jobs/4218031.html]]></guid><salary><![CDATA[$43.29 per hour]]></salary></item>
<item><title><![CDATA[Elsewhere]]></title><link><![CDATA[https://evil.example/jobs/1.html]]></link></item>
</channel></rss>`;

describe("BambooHR", () => {
  it("reads the careers list on the company's own subdomain", () => {
    expect(boardUrl({ board: "bamboohr", slug: "kiln" })).toBe("https://kiln.bamboohr.com/careers/list");
    const jobs = normalize("bamboohr", BAMBOO, "kiln");
    expect(jobs[0]).toMatchObject({ id: "351", title: "Software Engineer", url: "https://kiln.bamboohr.com/careers/351", location: "Lehi, Utah", hint: "Full-Time" });
    expect(jobs[1]).toMatchObject({ id: "52", location: "Remote", hint: "Part-Time" });
  });

  it("gives nothing for a page that is not the list, or a slug that is not a host", () => {
    expect(normalize("bamboohr", "<html>moved</html>", "kiln")).toEqual([]);
    expect(normalize("bamboohr", BAMBOO, "evil.com/x")).toEqual([]);
  });
});

describe("ApplicantPro", () => {
  it("reads the RSS feed: title, link, yearly pay from the salary, skills from the description", () => {
    expect(boardUrl({ board: "applicantpro", slug: "utcourts" })).toBe("https://utcourts.applicantpro.com/feeds/rsswidget.xml");
    const jobs = normalize("applicantpro", APPLICANTPRO, "utcourts");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: "4218031", title: "IT Systems Administrator", url: "https://utcourts.applicantpro.com/jobs/4218031.html", location: "", payMin: 90043, payMax: 90043 });
    expect(jobs[0]!.skills).toEqual(expect.arrayContaining(["AWS", "Python"]));
  });

  it("drops links to other hosts, and an empty feed (any subdomain answers) is no board", () => {
    expect(normalize("applicantpro", APPLICANTPRO, "utcourts").some((j) => j.url.includes("evil"))).toBe(false);
    expect(normalize("applicantpro", "<rss><channel><title></title></channel></rss>", "nobody")).toEqual([]);
    expect(normalize("applicantpro", { not: "text" }, "utcourts")).toEqual([]);
  });
});

describe("Subdomain boards stay on their own host", () => {
  it("allows only that one host per read", () => {
    expect(boardHost({ board: "bamboohr", slug: "kiln" })).toBe("kiln.bamboohr.com");
    expect(boardHost({ board: "applicantpro", slug: "a.b" })).toBeNull();
    expect(boardHost({ board: "greenhouse", slug: "kiln" })).toBeNull();
    expect(() => assertAllowed("https://kiln.bamboohr.com/careers/list")).toThrow();
    expect(() => assertAllowed("https://kiln.bamboohr.com/careers/list", ["kiln.bamboohr.com"])).not.toThrow();
  });

  it("the board finder spots both in a careers page", () => {
    const html = `<iframe src="https://kiln.bamboohr.com/careers/embed"></iframe><a href="https://skullcandy.applicantpro.com/jobs/">Jobs</a>`;
    expect(boardsInHtml(html).map((b) => `${b.board}:${b.slug}`)).toEqual(["bamboohr:kiln", "applicantpro:skullcandy"]);
  });
});

describe("The Utah list as its own source", () => {
  it("is a source you can turn off, counted apart from your company boards", () => {
    expect(JOB_SOURCES.some((s) => s.name === "Utah companies")).toBe(true);
    expect(sourceGroup(`Qualtrics careers${UTAH_LIST_TAG}`)).toBe("Utah companies");
    expect(sourceGroup("Qualtrics careers")).toBe("Company boards");
    expect(sourceGroup("Remote OK")).toBe("Remote OK");
  });

  it("shows under its own name in the run's quality record", () => {
    const { quality } = observeTech(
      [
        { key: "a", source: `Pattern careers${UTAH_LIST_TAG}`, title: "Data Engineer", company: "Pattern", url: "https://jobs.lever.co/pattern/a", location: "Lehi, UT", text: "full time", postedAt: null },
        { key: "b", source: "Acme careers", title: "Software Engineer", company: "Acme", url: "https://x.com/b", location: "Remote - US", text: "full time", postedAt: null },
      ],
      new Set(),
      "2026-11-23",
    );
    expect(quality.sources.map((s) => s.source).sort()).toEqual(["Company boards", "Utah companies"]);
  });
});
