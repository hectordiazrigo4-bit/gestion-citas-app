-- Cada cuenta trabaja con un único negocio: un usuario no puede tener más de una pertenencia.
-- La restricción va en la base de datos, así no depende solo del código de la aplicación.

CREATE UNIQUE INDEX idx_memberships_un_negocio_por_usuario ON memberships (user_id);
