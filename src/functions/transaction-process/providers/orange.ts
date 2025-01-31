import { Logger, LoggerService } from '@mu-ts/logger';
import { SecretsManagerService } from '../../../services/secretsManagerService';

export class OrangePaymentService {
  private readonly logger: Logger;

  private readonly secretsManagerService: SecretsManagerService;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
    this.logger.info('init()');
  }

  public async processPayment(
    amount: number,
    mobileNo: string
  ): Promise<string> {
    this.logger.info('Processing Orange Money payment', { amount, mobileNo });

    const orangeSecret = await this.secretsManagerService.getSecret(
      process.env.ORANGE_API_SECRET as string
    );
    this.logger.info('Retrieved Orange API secret', orangeSecret);

    // TODO: Call Orange Money API here
    return 'Orange payment successful';
  }
}
