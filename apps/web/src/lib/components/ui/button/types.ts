export type ButtonVariant = 'primary' | 'accent' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  href?: string;
  type?: 'button' | 'submit' | 'reset';
  class?: string;
  onclick?: (e: MouseEvent) => void;
  children: import('svelte').Snippet;
}
