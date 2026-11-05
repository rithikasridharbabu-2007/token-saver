from .permissions import is_allowed

def authorize_token(token, repository):
    account = repository.find_by_token(token)
    if account is None:
        raise ValueError("Invalid API token")
    return is_allowed(account, "read")
