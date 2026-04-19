import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownProps {
  children: string;
}

/**
 * Thin wrapper around react-markdown that applies our `.markdown` styles. We deliberately
 * skip syntax highlighting to keep the bundle small — code blocks render with monospace
 * styling and a subtle background, which is enough for short snippets in chat.
 */
export function Markdown({ children }: MarkdownProps) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
