/**
 * WizardAmp palette — Matrix-green tones for the wizard's forced-dark canvas.
 */

export type VisualizerPalette = {
  /** Panel borders, scaffolding, dim glyphs */
  fade: string;
  bright: string;
  mid: string;
  head: string;
  book: readonly string[];
  deleteRed: string;
  upGreen: string;
};

export const VISUALIZER_PALETTE: VisualizerPalette = {
  fade: '#0E7A0E',
  bright: '#7CFF7C',
  mid: '#22D622',
  head: '#E6FFE6',
  book: ['#22D622', '#7CFF7C', '#5BE05B', '#A0F0A0', '#36B536'],
  deleteRed: '#D63B22',
  upGreen: '#7CFF7C',
};
