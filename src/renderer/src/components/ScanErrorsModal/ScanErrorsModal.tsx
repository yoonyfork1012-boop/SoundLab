interface ScanErrorsModalProps {
  errors: { filePath: string; message: string }[];
  onClose: () => void;
}

// 인덱싱 중 손상되었거나 읽을 수 없어 건너뛴 파일 목록. 이런 파일이 있어도 인덱싱 자체는
// 중단되지 않고 끝까지 진행되며, 어떤 파일이 문제였는지는 여기서 확인한다.
export default function ScanErrorsModal({
  errors,
  onClose,
}: ScanErrorsModalProps): JSX.Element {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal scan-errors-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="건너뛴 파일"
      >
        <div className="modal__title">
          건너뛴 파일 {errors.length.toLocaleString()}개
        </div>
        <div className="modal__desc">
          아래 파일은 손상되었거나 읽을 수 없어 분석을 건너뛰었습니다. 나머지
          파일의 인덱싱은 정상적으로 끝났습니다.
        </div>
        <ul className="scan-errors">
          {errors.map((e) => (
            <li key={e.filePath} className="scan-errors__item">
              <span className="scan-errors__path" title={e.filePath}>
                {e.filePath}
              </span>
              <span className="scan-errors__msg">{e.message}</span>
            </li>
          ))}
        </ul>
        <div className="modal__actions">
          <button className="modal__btn modal__btn--primary" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
