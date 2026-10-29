// Đồng hồ được tiêm vào để kiểm thử điều khiển được thời gian
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
