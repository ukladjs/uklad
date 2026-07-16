export type BadgeOpType = string;
export type BadgeSize = 'xs' | 'sm' | 'md' | 'lg';
export type BadgeStyle = 'solid' | 'soft' | 'outline';

interface BadgeProps {
    label: string;
    opType?: BadgeOpType;
    size?: BadgeSize;
    style?: BadgeStyle;
    className?: string;
    variantClass?: string;
}

const getOpTypeBadgeVariant = (opType: string | undefined): BadgeOpType => {
    if (!opType) return 'neutral';

    switch (opType.toLowerCase()) {
        case 'db':
            return 'success';
        case 'render':
            return 'info';
        case 'sub/dispose':
            return 'secondary';
        case 'sub/run':
            return 'primary';
        case 'sub/create':
            return 'warning';
        case 'fx':
            return 'ghost';
        default:
            return 'neutral';
    }
};

export const Badge = function Badge({ label, opType, size = 'xs', style = 'soft', className = '' }: BadgeProps)  {
    const baseClasses = 'badge';

    const variantMap: Record<string, string> = {
        success: 'badge-success',
        info: 'badge-info',
        secondary: 'badge-secondary',
        primary: 'badge-primary',
        warning: 'badge-warning',
        ghost: 'badge-ghost',
        neutral: 'badge-neutral'
    };
    const variant = getOpTypeBadgeVariant(opType);
    const variantClass = variantMap[variant] ?? 'badge-neutral';

    const sizeMap: Record<BadgeSize, string> = {
        xs: 'badge-xs',
        sm: 'badge-sm',
        md: '',
        lg: 'badge-lg'
    };
    const sizeClass = sizeMap[size] ?? '';

    const styleMap: Record<BadgeStyle, string> = {
        solid: '',
        soft: 'badge-soft',
        outline: 'badge-outline'
    };
    const styleClass = styleMap[style] ?? '';

    const classes = [baseClasses, variantClass, sizeClass, styleClass, className, "whitespace-nowrap rounded-none px-0.5 py-0"].filter(Boolean).join(' ');
  
    return (
        <div className={classes}>
            {label}
        </div>
    );
};