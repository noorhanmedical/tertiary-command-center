export interface ParsedPatient {
  time?: string;
  name: string;
  age?: number;
  gender?: string;
  insurance?: string;
  diagnoses?: string;
  history?: string;
  medications?: string;
  previousTests?: string;
  noPreviousTests?: boolean;
  notes?: string;
  rawText?: string;
}
