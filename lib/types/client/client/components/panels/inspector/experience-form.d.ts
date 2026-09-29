import type { Dict } from '../../../i18n.js';
export interface ExperienceFormProps {
    data: Record<string, unknown>;
    copy: Dict;
    onPatch(patch: Record<string, unknown>): void;
}
export declare function ExperienceForm({ data, copy, onPatch }: ExperienceFormProps): import("react").JSX.Element;
