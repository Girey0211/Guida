interface Props {
  title: string;
  description?: string;
  /** 우측 액션 영역 */
  action?: React.ReactNode;
}

/** 페이지 상단 공통 헤더 */
export function PageHeader({ title, description, action }: Props) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
