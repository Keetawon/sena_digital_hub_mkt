export type WebsiteSource = { url: string; fetched_at: string };

export function PublicWebsiteSource({ sources }: { sources?: WebsiteSource[] | null }) {
  if (!sources?.length) return null;
  return <div className="small-text"><strong>ดึงจากเว็บไซต์สาธารณะ SENA</strong><p>แหล่งข้อมูล · ยังไม่ใช่การอนุมัติโดยบุคคล</p>
    {sources.map(source => <p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">เปิดต้นทาง</a>{" · "}
      <time dateTime={source.fetched_at}>{new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(source.fetched_at))}</time></p>)}
  </div>;
}
