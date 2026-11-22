export interface LoginRequestDto {
  correo: string;
  contrasena: string;
}

export interface LoginRanchoDto {
  idRancho: string;
  nombre: string;
  rol: string;
}

export interface LoginResponseDto {
  token: string;
  expiraEn: string;
  idUsuario: string;
  nombre: string;
  ranchos: LoginRanchoDto[];
}

export interface CreateUsuarioRequestDto {
  nombre: string;
  correo: string;
  contrasena: string;
  estado: string;
  idUsuario?: string;
}

export interface UsuarioResponseDto {
  idUsuario: string;
  nombre: string;
  correo: string;
  estado: string;
  creadoEn: string;
}

export interface BackendRanchoPayload {
  idRancho?: string;
  nombre: string;
  ubicacionGeneral: string;
  estado: string;
}

export interface CreateUsuarioRanchoPayload {
  idUsuarioRancho?: string;
  idUsuario: string;
  idRancho: string;
  rol: string;
  estado: string;
}

export interface AuthSession {
  token: string;
  expiraEn: string;
  idUsuario: string;
  nombre: string;
  correo: string;
  ranchos: LoginRanchoDto[];
}

export interface RegisterUserInput {
  nombre: string;
  correo: string;
  contrasena: string;
  estado?: string;
}

export interface RanchInput {
  nombre: string;
  ubicacionGeneral: string;
  estado: string;
}
