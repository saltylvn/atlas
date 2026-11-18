import { describe, expect, it } from "vitest";
import { declutter, emailAgentReport, jobKind, matchPhrases, senderKey, senderMatches, tagEmail, tagInbox, type EmailPrefs } from "@/lib/domain/emailAgent";
import type { InboxItem } from "@/lib/domain/types";
import { gmailDecimalId, gmailHexId, parseUnsubscribe } from "@/lib/integrations/gmailImap";
import { assertPublicHttps, isPublicIPv4, isPublicIPv6, UnsafeTargetError } from "@/lib/security/oneClick";

let seq = 0;
const mail = (fromName: string, fromEmail: string, subject: string, over: Partial<InboxItem> = {}): InboxItem => {
  seq++;
  return {
    id: `i${seq}`,
    messageId: `m${seq}`,
    threadId: `t${seq}`,
    fromName,
    fromEmail,
    subject,
    snippet: "",
    receivedAt: new Date(Date.UTC(2026, 10, 16, 12, seq)).toISOString(),
    category: "fyi",
    reason: "Addressed to you",
    done: false,
    createdAt: "2026-11-16T12:00:00Z",
    ...over,
  };
};
const promo = (fromName: string, fromEmail: string, subject: string) => mail(fromName, fromEmail, subject, { category: "noise", reason: "Mailing list or automated" });

// Example lists in the shape the owner types them in Settings.
const prefs: EmailPrefs = {
  stores: ["Trader Joe's", "Amazon", "Costco"],
  subscriptions: ["Shiny Bubble Car Wash", "Harborview Insurance", "Lakeshore Financial (Car Payment)", "Disney/Hulu", "Amazon subscription", "North Star loan payment", "Apex Fitness"],
  unsubscribed: ["oldbrand.com"],
};

describe("Email Agent: senders and your lists", () => {
  it("reduces a sender to its organization domain", () => {
    expect(senderKey("deals@email.costco.com")).toBe("costco.com");
    expect(senderKey("news@bbc.co.uk")).toBe("bbc.co.uk");
    expect(senderKey("a@shop.example")).toBe("shop.example");
  });

  it("reads entries the way you write them", () => {
    expect(matchPhrases("Lakeshore Financial (Car Payment)")).toEqual(["lakeshore financial"]);
    expect(matchPhrases("Disney/Hulu")).toEqual(["disney", "hulu"]);
    expect(matchPhrases("North Star loan payment")).toEqual(["north star"]);
    expect(matchPhrases("Trader Joe's")).toEqual(["trader joes"]);
  });

  it("matches senders by name or domain", () => {
    expect(senderMatches("North Star loan payment", { fromName: "NorthStar Financial", fromEmail: "noreply@northstarfinancial.com" })).toBe(true);
    expect(senderMatches("Harborview Insurance", { fromName: "Harborview", fromEmail: "service@e.harborview.com" })).toBe(true);
    expect(senderMatches("Shiny Bubble Car Wash", { fromName: "Shiny Bubble", fromEmail: "hello@shinybubble.com" })).toBe(true);
    expect(senderMatches("Disney/Hulu", { fromName: "Hulu", fromEmail: "hulu@hulumail.com" })).toBe(true);
    expect(senderMatches("Trader Joe's", { fromName: "Trader Joe's", fromEmail: "news@traderjoes.com" })).toBe(true);
    expect(senderMatches("Shiny Bubble Car Wash", { fromName: "Shiny Lane Auto", fromEmail: "x@shinylane.com" })).toBe(false);
  });
});

describe("Email Agent: tags", () => {
  it("sorts job emails by kind, and ignores job alerts", () => {
    expect(jobKind({ fromEmail: "no-reply@us.greenhouse-mail.io", subject: "Thank you for applying to Acme", category: "noise" })).toBe("confirmation");
    expect(jobKind({ fromEmail: "recruiting@acme.com", subject: "Interview availability for Solutions Engineer", category: "fyi" })).toBe("interview");
    expect(jobKind({ fromEmail: "no-reply@hire.lever.co", subject: "Update on your application", category: "noise" })).toBe("reply");
    expect(jobKind({ fromEmail: "jane@startup.io", subject: "Solutions Architect opportunity", category: "fyi" })).toBe("recruiter");
    expect(jobKind({ fromEmail: "jobalerts-noreply@linkedin.com", subject: "New jobs for you: Solutions Engineer", category: "noise" })).toBeNull();
    expect(jobKind({ fromEmail: "deals@shop.com", subject: "New opportunity to save!", category: "noise" })).toBeNull();
  });

  it("keeps Amazon deals with the store and Amazon billing with the subscription", () => {
    expect(tagEmail(mail("Amazon.com", "shipment-tracking@amazon.com", "Your package has shipped"), prefs)).toMatchObject({ tag: "store", matched: "Amazon" });
    expect(tagEmail(mail("Amazon Prime", "prime@amazon.com", "Your Prime membership renews soon"), prefs)).toMatchObject({ tag: "subscription", matched: "Amazon subscription" });
  });

  it("counts banks and bills as finance, and tracks subscriptions by name", () => {
    expect(tagEmail(mail("Chase", "no.reply.alerts@chase.com", "Your statement is ready"), prefs).tag).toBe("finance");
    expect(tagEmail(mail("Lakeshore Financial", "customercare@lakeshorefinancial.com", "Payment received"), prefs)).toMatchObject({ tag: "subscription", matched: "Lakeshore Financial (Car Payment)" });
    expect(tagEmail(promo("Some Shop", "deals@someshop.com", "Payment plans now available!"), prefs).tag).toBeNull();
  });

  it("moves an interview invite into needs a reply", () => {
    const [t] = tagInbox([mail("Acme Recruiting", "talent@acme.com", "Schedule your interview", { category: "noise", reason: "Notification sender" })], prefs);
    expect(t).toMatchObject({ category: "reply", reason: "Interview invite", tag: "job", jobKind: "interview" });
  });
});

describe("Email Agent: declutter", () => {
  it("proposes promotional senders you don't keep, most emails first", () => {
    const items = tagInbox(
      [
        promo("Brand A", "news@mail.branda.com", "Sale ends tonight"),
        promo("Brand A", "news@mail.branda.com", "New arrivals"),
        promo("Brand B", "hello@brandb.com", "Weekly picks"),
        promo("Costco", "deals@email.costco.com", "Member deals"), // a store you keep
        promo("Old Brand", "x@oldbrand.com", "Come back"), // already unsubscribed
        promo("Chase", "offers@chase.com", "Card offer"), // finance sender
        mail("Brand C", "ceo@brandc.com", "Quick question for you"), // not promotional
      ],
      prefs,
    );
    expect(declutter(items, prefs).map((d) => [d.key, d.count])).toEqual([
      ["branda.com", 2],
      ["brandb.com", 1],
    ]);
  });
});

describe("Email Agent: report", () => {
  it("leads with replies, counts finance, lists job emails and subscription updates, and asks approval to declutter", () => {
    const r = emailAgentReport({
      slot: "morning",
      sync: "ok",
      prefs,
      items: [
        mail("Dana", "dana@example.com", "Can you review this?", { category: "reply", reason: "Asks you something directly" }),
        mail("Chase", "alerts@chase.com", "Payment due soon"),
        mail("Apex Fitness", "membership@apexfitness.com", "Your membership renews Dec 1"),
        mail("Acme", "no-reply@greenhouse.io", "Thank you for applying to Acme"),
        promo("Brand A", "news@branda.com", "Sale"),
      ],
    });
    expect(r.report.headline).toBe("1 email needs a reply, 1 finance, 1 job, 1 sender to declutter.");
    expect(r.section).toMatchObject({ finance: 1, declutter: 1 });
    expect(r.section.subscriptions).toEqual([{ name: "Apex Fitness", subject: "Your membership renews Dec 1", receivedAt: expect.any(String) }]);
    expect(r.section.jobs?.[0]).toMatchObject({ kind: "confirmation", fromName: "Acme" });
    expect(r.report.needsApproval).toEqual(["Unsubscribe from Brand A (branda.com, 1 email)"]);
  });

  it("says when Gmail could not be read, and reports on the last good sync", () => {
    const r = emailAgentReport({ slot: "morning", sync: "error", syncMessage: "Gmail refused the app password", prefs, items: [] });
    expect(r.report.errors[0]).toContain("Gmail refused the app password");
    expect(r.report.errors[0]).toContain("last good sync");
  });
});

describe("Gmail helpers", () => {
  it("converts Gmail ids between hex (stored) and decimal (IMAP)", () => {
    expect(gmailDecimalId("ff")).toBe("255");
    expect(gmailHexId(gmailDecimalId("18c2f0a1b2c3d4e5")!)).toBe("18c2f0a1b2c3d4e5");
    expect(gmailDecimalId("demo5")).toBeNull();
  });

  it("reads one-click unsubscribe headers, keeping only https and mailto links", () => {
    expect(parseUnsubscribe("<mailto:unsub@brand.com?subject=unsubscribe>, <https://brand.com/u/abc>", "List-Unsubscribe=One-Click")).toEqual({
      https: "https://brand.com/u/abc",
      mailto: "mailto:unsub@brand.com?subject=unsubscribe",
      oneClick: true,
    });
    expect(parseUnsubscribe("<http://brand.com/u>", "List-Unsubscribe=One-Click")).toEqual({ https: "", mailto: "", oneClick: false });
    expect(parseUnsubscribe("<https://brand.com/u>", "")).toMatchObject({ oneClick: false });
  });
});

describe("One-click unsubscribe safety", () => {
  it("treats private, loopback, link-local and reserved addresses as unsafe", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.5.4", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1"]) expect(isPublicIPv4(ip)).toBe(false);
    expect(isPublicIPv4("8.8.8.8")).toBe(true);
    for (const ip of ["::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1"]) expect(isPublicIPv6(ip)).toBe(false);
    expect(isPublicIPv6("2606:4700:4700::1111")).toBe(true);
  });

  it("refuses non-https, IP literals, internal names, credentials and odd ports before any lookup", async () => {
    for (const url of ["http://brand.com/u", "https://169.254.169.254/latest", "https://[::1]/x", "https://localhost/u", "https://printer.local/u", "https://user:pw@brand.com/u", "https://brand.com:8443/u", "https://intranet/u"]) {
      await expect(assertPublicHttps(url)).rejects.toBeInstanceOf(UnsafeTargetError);
    }
  });
});
