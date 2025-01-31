import { Logger, LoggerService } from '@mu-ts/logger';
import { SecretsManagerService } from '../../../services/secretsManagerService';

export class MtnPaymentService {
  private readonly logger: Logger;

  private readonly secretsManagerService: SecretsManagerService;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
  }

  public async processPayment(
    amount: number,
    mobileNo: string
  ): Promise<string> {
    this.logger.info('Processing MTN Mobile Money payment', {
      amount,
      mobileNo,
    });

    const mtnSecret = await this.secretsManagerService.getSecret(
      process.env.MTN_API_SECRET as string
    );
    this.logger.info('Retrieved MTN API secret', mtnSecret);

    // TODO: Call MTN API here
    return 'MTN payment successful';
  }
}
