"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { request } from "./hub-request";
import "./questions.css";

export const questionGroups = { note: "พี่โน้ต", finance: "ฝ่ายการเงิน", dpo: "เจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล", media: "ทีมมีเดีย", marketing: "ทีมการตลาด", it: "ทีมไอที" } as const;
export type PendingQuestionData = {
  id: string; status: "PENDING"; owner_group: keyof typeof questionGroups;
  owner_th: string; question_th: string; default_th: string;
  links: { href: string; label: string }[];
};
type QuestionState = { questions: PendingQuestionData[]; loading: boolean; error: string; retry: () => void };
const QuestionContext = createContext<QuestionState | null>(null);

export function QuestionProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [questions, setQuestions] = useState<PendingQuestionData[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!enabled) { setQuestions([]); setLoading(false); setError(""); return; }
    let active = true;
    setLoading(true); setError(""); setQuestions([]);
    request<{ questions: PendingQuestionData[] }>("v1/admin/questions")
      .then(result => { if (active) setQuestions(result.questions.filter(question => question.status === "PENDING")); })
      .catch(() => { if (active) setError("โหลดรายการคำถามไม่สำเร็จ กรุณาลองอีกครั้ง"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [enabled, attempt]);
  // Keep data scoped to this mounted staff shell, never in a cross-user global cache.
  return <QuestionContext.Provider value={{ questions: enabled ? questions : [], loading: enabled && loading, error: enabled ? error : "", retry }}>{children}</QuestionContext.Provider>;
}

export function useQuestions() {
  const state = useContext(QuestionContext);
  if (!state) throw new Error("QuestionProvider is required");
  return state;
}

export function QuestionDetails({ question }: { question: PendingQuestionData }) {
  return <>
    <p className="question-owner"><strong>ผู้รับผิดชอบ:</strong> {question.owner_th}</p>
    <p><strong>ระหว่างรอคำตอบ:</strong> {question.default_th}</p>
    {question.links.length > 0 && <nav className="question-links" aria-label={`หน้าที่เกี่ยวข้องกับ ${question.id}`}>{question.links.map(link => <a key={link.href} href={link.href}>{link.label}</a>)}</nav>}
  </>;
}

export function PendingQuestion({ id }: { id: string }) {
  const { questions, loading, error } = useQuestions();
  const popoverId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const question = questions.find(item => item.id === id);
  function close() { popoverRef.current?.hidePopover(); buttonRef.current?.focus(); }
  if (loading) return <span className="question-loading">กำลังโหลดคำถาม…</span>;
  if (error) return <a className="question-load-error" href="/questions">โหลดคำถามไม่สำเร็จ</a>;
  if (!question) return null;
  return <>
    <button ref={buttonRef} type="button" className="pending-question-badge" popoverTarget={popoverId} aria-haspopup="dialog" aria-label={`รอคำตอบ ${id}`}><span aria-hidden="true">?</span> รอคำตอบ <span>{id}</span></button>
    <div ref={popoverRef} id={popoverId} className="question-popover" popover="auto" role="dialog" aria-labelledby={`${popoverId}-title`}
      onToggle={event => { if (event.newState === "open") headingRef.current?.focus(); }}
      onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.hidePopover(); }}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); close(); } }}>
      <div className="question-popover-heading"><span className="question-status">รอคำตอบ · {id}</span><button type="button" className="question-close" onClick={close} aria-label={`ปิดคำถาม ${id}`}>ปิด</button></div>
      <h2 ref={headingRef} id={`${popoverId}-title`} tabIndex={-1}>{question.question_th}</h2>
      <QuestionDetails question={question} />
      <a className="question-all-link" href={`/questions#${id}`}>ดูคำถามทั้งหมด</a>
    </div>
  </>;
}

export function QuestionsList() {
  const { questions, loading, error, retry } = useQuestions();
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (questions.some(question => question.id === id)) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [questions]);
  if (loading) return <p role="status" className="hub-loading">กำลังโหลดคำถาม…</p>;
  if (error) return <div className="notice error" role="alert"><p>{error}</p><button type="button" className="button" onClick={retry}>ลองอีกครั้ง</button></div>;
  if (!questions.length) return <p role="status">ไม่มีคำถามที่รอคำตอบในขณะนี้</p>;
  return <div className="questions-groups">{Object.entries(questionGroups).map(([group, label]) => {
    const items = questions.filter(question => question.owner_group === group);
    if (!items.length) return null;
    return <section key={group} aria-labelledby={`question-group-${group}`} className="questions-group"><h2 id={`question-group-${group}`}>{label}</h2><div className="question-cards">{items.map(question => <article key={question.id} id={question.id} className="question-card" aria-labelledby={`question-title-${question.id}`}>
      <span className="question-status">รอคำตอบ · {question.id}</span>
      <h3 id={`question-title-${question.id}`}>{question.question_th}</h3>
      <QuestionDetails question={question} />
    </article>)}</div></section>;
  })}</div>;
}
