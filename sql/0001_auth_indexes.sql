IF NOT EXISTS (
    SELECT 1
    FROM sys.key_constraints
    WHERE type = 'PK'
      AND parent_object_id = OBJECT_ID(N'dbo.A30_Employee')
)
BEGIN
    ALTER TABLE dbo.A30_Employee
      ADD CONSTRAINT PK_A30_Employee PRIMARY KEY CLUSTERED (id);
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.key_constraints
    WHERE type = 'PK'
      AND parent_object_id = OBJECT_ID(N'dbo.A30_User')
)
BEGIN
    ALTER TABLE dbo.A30_User
      ADD CONSTRAINT PK_A30_User PRIMARY KEY CLUSTERED (id);
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'UX_A30_Employee_employee_code'
      AND object_id = OBJECT_ID(N'dbo.A30_Employee')
)
BEGIN
    CREATE UNIQUE INDEX UX_A30_Employee_employee_code
      ON dbo.A30_Employee (employee_code);
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'UX_A30_User_active_user_code'
      AND object_id = OBJECT_ID(N'dbo.A30_User')
)
BEGIN
    CREATE UNIQUE INDEX UX_A30_User_active_user_code
      ON dbo.A30_User (user_code)
      WHERE user_code IS NOT NULL AND is_delete = 0;
END;
GO
