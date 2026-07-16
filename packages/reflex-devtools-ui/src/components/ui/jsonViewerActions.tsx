import type { CustomAction } from 'react-obj-view';

type ActionWrapperProps<T = {}> = {
    state: T;
    isLoading: boolean;
    isSuccess: boolean;
    isError: boolean;
    children: any;
    handleAction?: () => void;
};

const CopyIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
);

const allowJSONPrototype = new Set<any>([
    Object.getPrototypeOf({}),
    Object.getPrototypeOf([]),
    Object.getPrototypeOf(new Date),
    {}.constructor,
    [].constructor,
    (new Date).constructor,
]);

export const DEFAULT_ACTION: CustomAction[] = [
    {
        name: "copy",
        dependency: (data) => [typeof data.value],
        prepareAction(data) {
            if (data.key == "[[Prototype]]")
                return;

            let valueType = typeof data.value;
            let copyText = valueType == 'string' || valueType == 'number' || valueType == 'bigint';
            let copyJSON = !copyText
                && data.value !== null
                && valueType == 'object'
                && allowJSONPrototype.has(Object.getPrototypeOf(data.value))
                && allowJSONPrototype.has(data.value?.constructor);

            return copyText || copyJSON ? { copyText, copyJSON } : undefined;
        },
        performAction({ copyText, copyJSON }, nodeData) {
            if (copyText) {
                return navigator.clipboard.writeText(String(nodeData.value));
            } else if (copyJSON) {
                return new Promise(r => (window?.requestIdleCallback ?? window?.requestAnimationFrame)(r))
                    .then(() => JSON.stringify(nodeData.value, null, 2))
                    .then(text => navigator.clipboard.writeText(text));
            }
            return undefined;
        },
        buttonWrapper: ({ isError, isLoading, isSuccess, handleAction, children, ...buttonProps }: ActionWrapperProps & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
            if (!children) return null;
            return (
                <button
                    {...buttonProps}
                    type="button"
                    onClick={handleAction}
                    style={{ background: 'transparent', border: 'none' }}
                >
                    {children}
                </button>
            );
        },
        actionRender: ({ copyJSON, copyText }) => {
            if (copyText) return <CopyIcon className="w-4 h-4" />;
            if (copyJSON) return <CopyIcon className="w-4 h-4" />;
            return null;
        },
        actionRunRender: () => <CopyIcon className="w-4 h-4" />,
        actionSuccessRender: () => <CopyIcon className="w-4 h-4 text-green-500" />
    } as CustomAction<{ copyText?: boolean; copyJSON?: boolean; }>,
];