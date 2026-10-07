// The reading style setting for space Markdown. The reader and the WYSIWYG
// editor set it as data-reading-style on the element wrapping the document;
// the stylesheets in reading-styles/ style everything under it.
import { useSettings } from "@get-bb/plugin-sdk/app";
import "./reading-styles/blue-topaz.css";
import "./reading-styles/things.css";

export type ReadingStyle = "blue-topaz" | "things" | "plain";

export function useReadingStyle(): ReadingStyle {
  const { values } = useSettings();
  const style = values?.readingStyle;
  return style === "things" || style === "plain" ? style : "blue-topaz";
}
