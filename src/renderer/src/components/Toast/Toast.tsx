interface ToastProps {
  message: string;
}

export default function Toast({ message }: ToastProps): JSX.Element {
  return (
    <div className="toast">
      <span>{message}</span>
    </div>
  );
}
