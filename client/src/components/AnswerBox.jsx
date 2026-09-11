// The extractable one-paragraph summary under every entity H1: plain data,
// no marketing, server-rendered, identical to the JSON-LD description.
export default function AnswerBox({ text }) {
  if (!text) return null;
  return (
    <p className="answer-box" data-answer-box>
      {text}
    </p>
  );
}
