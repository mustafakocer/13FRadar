// Every UI icon in the app: a lucide outline glyph that inherits the text
// colour (currentColor). 16px inline, 18px in navigation, 1.75 stroke.
export default function Ico({ icon: I, size = 16, className = '', ...rest }) {
  return <I size={size} strokeWidth={1.75} aria-hidden="true" focusable="false" className={`ico-svg ${className}`.trim()} {...rest} />;
}
