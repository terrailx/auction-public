"use strict";

function doctorLink(id, asset, index) {
  const url = new URL(detailLink(id, asset, index), location.origin);
  url.searchParams.set("panel", "doctor");
  return url.pathname + url.search;
}

function caseDoctor(caseId, asset, event) {
  const panel = node("aside", null, "doctor-panel");
  panel.id = "case-doctor";
  panel.hidden = true;
  panel.setAttribute("aria-label", "경매박사 검토");
  const title = node("header");
  const close = btn("닫기", () => toggle(false), "quiet");
  title.append(node("h2", "경매박사"), close);
  const content = node("div", null, "doctor-content");
  panel.append(title, content);
  const button = btn("경매박사", () => toggle(panel.hidden), "doctor-trigger");
  button.setAttribute("aria-controls", panel.id);
  button.setAttribute("aria-expanded", "false");
  let loaded = false;
  function toggle(open) {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) {
      close.focus();
      if (!loaded) load();
    } else button.focus();
  }
  panel.addEventListener("keydown", e => { if (e.key === "Escape") toggle(false); });
  function card(title, ...items) {
    const section = node("section");
    section.append(node("h3", title), ...items);
    return section;
  }
  function sourceLink(title, href) {
    const a = node("a", title);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  }
  async function load() {
    loaded = true;
    content.replaceChildren(node("p", "사건과 연구자료를 확인하는 중입니다."));
    if (!caseId) {
      content.replaceChildren(card("오늘 할 일",
        node("p", event ? "사건번호와 법원·주소를 저장본과 대조해야 합니다." : "이 물건에 연결된 저장 사건이 없습니다."),
        node("p", "기일 미확인. 사건번호·법원·호실을 먼저 확인하세요.")));
      return;
    }
    try {
      const query = asset ? "?" + new URLSearchParams({property: asset.id}) : "";
      const response = await fetch("/auction-public/auction/doctor/" + encodeURIComponent(caseId) + query);
      if (!response.ok) throw Error("이 사건의 검토자료를 열지 못했습니다.");
      const d = await response.json();
      const caseName = node("p", [d.case, d.court].filter(Boolean).join(" · "), "doctor-case");
      const related = node("div", null, "doctor-related");
      for (const [i, e] of (asset?.cases || []).entries()) {
        if (e.id !== caseId) related.append(sourceLink(e.case || "사건번호 미확인", doctorLink(e.id, asset, i)));
      }
      const today = card("오늘 할 일",
        node("p", d.nextDate ? "수집본상 다음 매각기일 " + d.nextDate + " · D-" + d.days : "다음 매각기일 미확인"),
        ...(d.paymentDays == null ? [] : [node("p",
          "저장기록상 대금지급기한 " + d.paymentDue + " · " +
          (d.paymentDays >= 0 ? "D-" + d.paymentDays : Math.abs(d.paymentDays) + "일 경과"))]),
        node("p", "기록 기준 " + (capturedTime(d.capturedAt) || "미확인") + " · 계산 기준 " + d.today),
        node("p", "기일표·사건내역과 담당계 기록을 대조하세요."));
      const court = card("법원 대응",
        node("p", "원장 단계 · " + (d.stage || "미확인")),
        summary([["매각결정기일", d.decision], ["대금지급기한", d.paymentDue], ["완납일", d.paid]]),
        node("p", "확인할 서류 · 사건내역, 문건·송달, 법원 기일표"));
      const creditor = card("은행·HUG 대응",
        node("p", "저장자료의 채권자 · " + (d.creditor || d.creditorType || "미확인")),
        node("p", d.creditorType?.includes("HUG")
          ? "대조할 자료 · 집행권원, 송달, 청구액과 변제 내역"
          : "대조할 자료 · 현재 채권자와 담당자, 정산액, 담보 목록, 말소·취하 조건"));
      const sources = node("ul");
      for (const f of d.files) {
        const li = node("li");li.append(sourceLink((labels[f.key] || f.key) + " · " + f.name, f.url));sources.append(li);
      }
      for (const f of d.studies) {
        const li = node("li");li.append(sourceLink(f.title, f.url));sources.append(li);
      }
      const question = node("textarea");
      question.setAttribute("aria-label", "경매박사 질문");
      question.placeholder = "이 사건은 은행에 먼저 무엇을 확인해야 하나요?";
      question.disabled = true;
      const ai = card("질문과 초안",
        node("p", "구독 연결 필요 · 1순위 모델 " + d.ai.preferredModel),
        node("p", "이 앱의 구독 사용 권한과 모델 호출을 확인하면 질문과 서면 초안을 사용할 수 있습니다."),
        question, sourceLink("OpenAI 구독 연결 조건", "https://developers.openai.com/siwc/quickstart"),
        sourceLink("OpenAI 앱 등록 안내", "https://developers.openai.com/siwc/request-client-id"));
      const work = asset
        ? sourceLink("물건 대응실에서 업무·증빙 열기", "/auction-public/auction/workbench?" + new URLSearchParams({property:asset.id,case:caseId}))
        : sourceLink("물건 대응실 열기", "/auction-public/auction/workbench");
      content.replaceChildren(caseName, related, today, court, creditor, card("근거", sources), work, ai);
    } catch (error) {
      loaded = false;
      content.replaceChildren(node("p", error.message), btn("자료 다시 열기", load, "quiet"));
    }
  }
  return {panel, button, open: () => toggle(true)};
}

