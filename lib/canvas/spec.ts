// Ported from bb-plugin-canvas (MIT, (c) 2026 Borja Marquez de la Plata):
// https://github.com/Borjampm/bb-plugin-canvas
//
// The diagram spec agents send with `space_draw` / `bb space draw`, which the
// app turns into tldraw shapes. The animated `steps` timeline of the original
// is left out: space canvases are documentation, saved as their final state.
import { z } from "zod";

export const canvasColors = [
  "black",
  "grey",
  "light-violet",
  "violet",
  "blue",
  "light-blue",
  "yellow",
  "orange",
  "green",
  "light-green",
  "light-red",
  "red",
] as const;

export const nodeSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(300),
  // Omit x/y to let the layout engine place the node (see `layout`).
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().positive().max(2000).optional(),
  h: z.number().positive().max(2000).optional(),
  shape: z.enum(["rect", "ellipse", "diamond", "note"]).optional(),
  color: z.enum(canvasColors).optional(),
});

export const edgeSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().max(200).optional(),
  color: z.enum(canvasColors).optional(),
  dashed: z.boolean().optional(),
});

export const textSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().max(2000),
  // Omit x/y and the text is stacked above the diagram (good for titles).
  x: z.number().optional(),
  y: z.number().optional(),
  size: z.enum(["s", "m", "l", "xl"]).optional(),
});

/**
 * How nodes without explicit x/y are placed.
 * - `auto` (default): layered left-to-right layout from the edge graph.
 * - `lr` / `tb`: force a layered layout for every node in this batch.
 * - `none`: no layout; nodes without x/y land at the origin.
 */
export const layoutSchema = z.enum(["auto", "lr", "tb", "none"]);

export const drawSpecSchema = z.object({
  clear: z.boolean().optional(),
  layout: layoutSchema.optional(),
  nodes: z.array(nodeSchema).max(120).optional(),
  edges: z.array(edgeSchema).max(200).optional(),
  texts: z.array(textSchema).max(60).optional(),
});

export type DrawSpec = z.infer<typeof drawSpecSchema>;
export type DrawLayout = z.infer<typeof layoutSchema>;
export type DrawNode = z.infer<typeof nodeSchema>;
export type DrawEdge = z.infer<typeof edgeSchema>;
export type DrawText = z.infer<typeof textSchema>;
