"use client";
import { unavailableMessage } from "@/lib/hub-account";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="account-page"><section className="registry-panel"><h1>{unavailableMessage}</h1><button className="button primary" onClick={reset}>ลองใหม่</button></section></main>;
}
