package user

// User is the central domain model representing an authenticated TenderHUB
// account, combining data from public.users and public.roles.
type User struct {
	// ID is the UUID from auth.users / public.users.id.
	ID string `json:"id"`

	// Email is the account's email address.
	Email string `json:"email"`

	// RoleCode is the raw role identifier, e.g. "engineer", "administrator".
	RoleCode string `json:"role_code"`

	// RoleName is the human-readable Russian display name of the role.
	RoleName string `json:"role_name"`

	// RoleColor is the Ant Design color token for the role badge.
	RoleColor string `json:"role_color"`

	// AccessStatus reflects the public.users.access_status column
	// (approved | pending | blocked).
	AccessStatus string `json:"access_status"`

	// AllowedPages is the computed list of page paths this user may visit.
	// Derived from the role's default access combined with any per-user
	// override stored in public.users.allowed_pages.
	AllowedPages []string `json:"allowed_pages"`

	// AccessEnabled mirrors public.users.access_enabled — a hard on/off switch
	// independent of access_status.
	AccessEnabled bool `json:"access_enabled"`
}
