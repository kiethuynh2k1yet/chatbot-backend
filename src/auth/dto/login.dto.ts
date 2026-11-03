import { Transform } from 'class-transformer';
import { IsString, Length, MaxLength } from 'class-validator';

export class LoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  username!: string;

  @IsString()
  @MaxLength(200)
  password!: string;
}
