import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function DecisionMarkdown({ value, compact = false }: { value: string; compact?: boolean }) {
  return <div className={`decision-markdown${compact ? " decision-markdown-compact" : ""}`}>
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
  </div>;
}
