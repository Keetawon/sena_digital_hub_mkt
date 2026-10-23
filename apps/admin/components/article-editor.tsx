"use client";

import { useEffect, useState } from "react";
import { Node, type JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import type { Locales } from "./content-common";

export type ArticleReferences = {
  categories: { code: string; label: Locales }[];
  projects: { ref: string; label: Locales }[]; brands: { ref: string; label: Locales }[]; programmes: { ref: string; label: Locales }[];
  images: { id: string; original_filename: string; alt_text: Locales; caption: Locales }[];
  videos: { id: string; title: Locales }[]; questions: { question_key: string; label: Locales }[];
};
const atomLabels = { libraryImage: "ภาพจากคลังสื่อ", mediaVideo: "วิดีโอที่ตรวจแล้ว", faqEmbed: "คำตอบจากคลัง FAQ", projectCard: "การ์ดโครงการ" };
const atoms = Object.entries(atomLabels).map(([name, label]) => Node.create({
  name, group: "block", atom: true, selectable: true,
  addAttributes() { return Object.fromEntries((name === "libraryImage" ? ["asset_id"] : name === "mediaVideo" ? ["media_link_id"] : name === "faqEmbed" ? ["project_id", "question_key"] : ["project_id"]).map(key => [key, { default: null }])); },
  // Reference blocks can only be inserted through the authorized library picker.
  parseHTML() { return []; },
  renderHTML() { return ["div", { class: "article-reference", contenteditable: "false" }, label]; },
}));
const Callout = Node.create({ name: "callout", group: "block", content: "block+", defining: true,
  parseHTML() { return [{ tag: "aside[data-article-callout]" }]; },
  renderHTML() { return ["aside", { "data-article-callout": "", class: "article-callout" }, 0]; },
});

export function ArticleEditor({ value, onChange, disabled, references, canReadProjects }: {
  value: JSONContent; onChange: (value: JSONContent) => void; disabled: boolean; references: ArticleReferences | null; canReadProjects: boolean;
}) {
  const [kind, setKind] = useState<keyof typeof atomLabels>("libraryImage");
  const [image, setImage] = useState(""); const [video, setVideo] = useState("");
  const [project, setProject] = useState(""); const [question, setQuestion] = useState("");
  const editor = useEditor({
    immediatelyRender: false, editable: !disabled,
    extensions: [StarterKit.configure({ heading: { levels: [2, 3, 4] }, link: false, underline: false, strike: false, code: false, codeBlock: false, horizontalRule: false }), TableKit, Callout, ...atoms],
    content: value,
    editorProps: { attributes: { id: "article-body", role: "textbox", "aria-label": "เนื้อหาบทความภาษาไทย", "aria-multiline": "true", "data-permission-recovery": "", lang: "th" } },
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
  });
  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);
  useEffect(() => {
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(value)) editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);
  const canInsert = kind === "libraryImage" ? Boolean(image) : kind === "mediaVideo" ? Boolean(video) && canReadProjects : Boolean(project) && canReadProjects && (kind !== "faqEmbed" || Boolean(question));
  function insert() {
    if (!editor || disabled || !canInsert) return;
    const attrs = kind === "libraryImage" ? { asset_id: image } : kind === "mediaVideo" ? { media_link_id: video } : kind === "faqEmbed" ? { project_id: project, question_key: question } : { project_id: project };
    editor.chain().focus().insertContent({ type: kind, attrs }).run();
  }
  return <section className="article-editor" aria-label="เครื่องมือเขียนบทความ">
    <p id="article-body-hint" className="field-help">เขียนภาษาไทยก่อน แล้วตรวจคำแปลทีละข้อความ ภาพและวิดีโอต้องเลือกจากรายการที่มีสิทธิ์ใช้งาน</p>
    <fieldset disabled={disabled || !editor} className="article-toolbar" aria-label="รูปแบบเนื้อหา">
      <button type="button" onClick={() => editor?.chain().focus().setParagraph().run()}>ย่อหน้า</button>
      <button type="button" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>หัวข้อใหญ่</button>
      <button type="button" onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>หัวข้อย่อย</button>
      <button type="button" onClick={() => editor?.chain().focus().toggleBold().run()}>ตัวหนา</button>
      <button type="button" onClick={() => editor?.chain().focus().toggleItalic().run()}>ตัวเอียง</button>
      <button type="button" onClick={() => editor?.chain().focus().toggleBulletList().run()}>รายการหัวข้อ</button>
      <button type="button" onClick={() => editor?.chain().focus().toggleOrderedList().run()}>รายการลำดับ</button>
      <button type="button" onClick={() => editor?.chain().focus().toggleBlockquote().run()}>คำกล่าว</button>
      <button type="button" onClick={() => editor?.chain().focus().toggleWrap("callout").run()}>กล่องข้อความ</button>
      <button type="button" onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()}>แทรกตาราง</button>
      <button type="button" onClick={() => editor?.chain().focus().addRowAfter().run()}>เพิ่มแถว</button>
      <button type="button" onClick={() => editor?.chain().focus().addColumnAfter().run()}>เพิ่มคอลัมน์</button>
      <button type="button" onClick={() => editor?.chain().focus().deleteRow().run()}>ลบแถว</button>
      <button type="button" onClick={() => editor?.chain().focus().deleteColumn().run()}>ลบคอลัมน์</button>
      <button type="button" onClick={() => editor?.chain().focus().deleteTable().run()}>ลบตาราง</button>
      <button type="button" onClick={() => editor?.chain().focus().undo().run()}>เลิกทำ</button>
      <button type="button" onClick={() => editor?.chain().focus().redo().run()}>ทำซ้ำ</button>
    </fieldset>
    <EditorContent editor={editor} />
    <fieldset disabled={disabled || !editor} className="article-reference-picker"><legend>แทรกเนื้อหาจาก Hub</legend>
      <label className="content-input">ชนิดเนื้อหา<select value={kind} onChange={event => setKind(event.target.value as keyof typeof atomLabels)}>{Object.entries(atomLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {kind === "libraryImage" && <label className="content-input">ภาพที่มีสิทธิ์ใช้งาน<select value={image} onChange={event => setImage(event.target.value)}><option value="">เลือกภาพ</option>{references?.images.map(row => <option key={row.id} value={row.id}>{row.alt_text.th || row.caption.th || row.original_filename}</option>)}</select></label>}
      {kind === "mediaVideo" && <label className="content-input">วิดีโอ<select value={video} disabled={!canReadProjects} onChange={event => setVideo(event.target.value)}><option value="">เลือกวิดีโอ</option>{references?.videos.map(row => <option key={row.id} value={row.id}>{row.title.th || "วิดีโอ"}</option>)}</select></label>}
      {(kind === "projectCard" || kind === "faqEmbed") && <label className="content-input">โครงการสำหรับเนื้อหา<select value={project} disabled={!canReadProjects} onChange={event => setProject(event.target.value)}><option value="">เลือกโครงการ</option>{references?.projects.map(row => <option key={row.ref} value={row.ref}>{row.label.th || row.ref}</option>)}</select></label>}
      {kind === "faqEmbed" && <label className="content-input">คำถามจากคลัง<select value={question} disabled={!canReadProjects} onChange={event => setQuestion(event.target.value)}><option value="">เลือกคำถาม</option>{references?.questions.map(row => <option key={row.question_key} value={row.question_key}>{row.label.th || row.question_key}</option>)}</select></label>}
      {kind !== "libraryImage" && !canReadProjects && <p>ต้องมีสิทธิ์ดูโครงการเพื่อเลือกเนื้อหาประเภทนี้</p>}
      <button type="button" className="button secondary" disabled={!canInsert} onClick={insert}>แทรกเนื้อหาที่เลือก</button>
    </fieldset>
  </section>;
}
