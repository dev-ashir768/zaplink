import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class TransferSessionOwnerDto {
  @ApiProperty({
    description: 'The OPERATOR or VIEWER API key id that will own the session, or null to make it admin-owned.',
    nullable: true,
    type: String,
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  ownerKeyId!: string | null;
}
